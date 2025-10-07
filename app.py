import os
import uuid
import cv2
import numpy as np
import base64
import threading
from flask import Flask, request, jsonify, render_template
from flask_cors import CORS
from flask_bcrypt import Bcrypt
from flask_jwt_extended import create_access_token, jwt_required, get_jwt_identity, JWTManager
from ultralytics import YOLO
from deep_sort_realtime.deepsort_tracker import DeepSort
import json

# --- APP AND EXTENSIONS CONFIGURATION ---
app = Flask(__name__)
app.config["JWT_SECRET_KEY"] = "your-super-secret-key-change-this" # IMPORTANT: Change this in a real application
app.config["SECRET_KEY"] = "another-secret-key-for-session"
CORS(app)
bcrypt = Bcrypt(app)
jwt = JWTManager(app)

# --- DATABASE AND FILE PATHS ---
DB_FILE = 'database.json'
UPLOAD_FOLDER = 'uploads'
os.makedirs(UPLOAD_FOLDER, exist_ok=True)
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER

# --- YOLO MODEL ---
try:
    model = YOLO("yolov8n.pt")
except Exception as e:
    print(f"CRITICAL ERROR: Could not load YOLO model. Make sure 'yolov8n.pt' is in the project directory. Details: {e}")
    model = None

# --- DEEPSORT TRACKER CREATION FUNCTION ---
def create_tracker():
    return DeepSort(max_age=30, n_init=3, nms_max_overlap=1.0)

# --- GLOBAL SESSION MANAGEMENT FOR VIDEO ---
video_sessions = {}
session_lock = threading.Lock()

# =============================
# ROBUST DATABASE HELPERS
# =============================
def read_db():
    if not os.path.exists(DB_FILE):
        initial_data = {"users": {}, "zones": {}}
        write_db(initial_data)
        return initial_data
    try:
        with open(DB_FILE, 'r', encoding='utf-8') as f:
            data = json.load(f)
            if 'users' not in data or not isinstance(data['users'], dict): data['users'] = {}
            if 'zones' not in data or not isinstance(data['zones'], dict): data['zones'] = {}
            return data
    except (json.JSONDecodeError, FileNotFoundError):
        return {"users": {}, "zones": {}}

def write_db(data):
    with open(DB_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=4)

# =============================
# AUTHENTICATION API ROUTES (FIXED)
# =============================
@app.route('/api/register', methods=['POST'])
def register():
    try:
        data = request.get_json()
        if not data: return jsonify({"message": "Request must be JSON"}), 400
        username, email, password = data.get('username'), data.get('email'), data.get('password')
        if not all([username, email, password]):
            return jsonify({"message": "All fields are required"}), 400
        db = read_db()
        if any(user['email'] == email for user in db['users'].values()):
            return jsonify({"message": "Email already registered"}), 409
        hashed_password = bcrypt.generate_password_hash(password).decode('utf-8')
        user_id = str(uuid.uuid4())
        db['users'][user_id] = {"username": username, "email": email, "password": hashed_password}
        write_db(db)
        access_token = create_access_token(identity=user_id)
        return jsonify(access_token=access_token, username=username), 201
    except Exception as e:
        return jsonify({"message": f"An internal server error occurred: {e}"}), 500

@app.route('/api/login', methods=['POST'])
def login():
    try:
        data = request.get_json()
        if not data: return jsonify({"message": "Request must be JSON"}), 400
        email, password = data.get('email'), data.get('password')
        if not all([email, password]): return jsonify({"message": "Email and password are required"}), 400
        db = read_db()
        user_to_login, user_id = None, None
        for uid, u_data in db['users'].items():
            if u_data['email'] == email:
                user_to_login, user_id = u_data, uid
                break
        if user_to_login and bcrypt.check_password_hash(user_to_login['password'], password):
            access_token = create_access_token(identity=user_id)
            return jsonify(access_token=access_token, username=user_to_login['username']), 200
        return jsonify({"message": "Invalid credentials"}), 401
    except Exception as e:
        return jsonify({"message": f"An internal server error occurred: {e}"}), 500

@app.route('/api/verify_token', methods=['POST'])
@jwt_required()
def verify_token():
    return jsonify(status="ok"), 200

# =============================
# ZONE & ANALYSIS ROUTES
# =============================
@app.route('/api/zones', methods=['GET', 'POST'])
@jwt_required()
def handle_zones():
    user_id = get_jwt_identity()
    db = read_db()
    if request.method == 'POST':
        zone_data = request.get_json()
        if not all([zone_data.get('name'), zone_data.get('coordinates')]):
            return jsonify({"message": "Zone name and coordinates are required"}), 400
        new_zone = {"id": str(uuid.uuid4()), "name": zone_data['name'], "coordinates": zone_data['coordinates']}
        if user_id not in db['zones']: db['zones'][user_id] = []
        db['zones'][user_id].append(new_zone)
        write_db(db)
        return jsonify({"message": "Zone saved", "zone": new_zone}), 201
    return jsonify({"zones": db['zones'].get(user_id, [])})

@app.route('/api/zones/<zone_id>', methods=['DELETE'])
@jwt_required()
def delete_zone_route(zone_id):
    user_id = get_jwt_identity()
    db = read_db()
    user_zones = db['zones'].get(user_id, [])
    if not any(z['id'] == zone_id for z in user_zones):
        return jsonify({"message": "Zone not found"}), 404
    db['zones'][user_id] = [z for z in user_zones if z['id'] != zone_id]
    write_db(db)
    return jsonify({"message": "Zone deleted"}), 200

@app.route('/api/upload_video', methods=['POST'])
@jwt_required()
def upload_video():
    if 'video' not in request.files: return jsonify({"error": "No video file part"}), 400
    file = request.files['video']
    if file.filename == '': return jsonify({"error": "No selected file"}), 400
    user_id = get_jwt_identity()
    filename = f"{user_id}_{uuid.uuid4().hex}_{os.path.basename(file.filename)}"
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    with session_lock:
        if user_id in video_sessions and video_sessions[user_id].get('cap'):
            video_sessions[user_id]['cap'].release()
        video_sessions[user_id] = {'filepath': filepath}
    return jsonify({"message": "Video uploaded successfully"}), 200

@app.route('/api/analysis/start', methods=['POST'])
@jwt_required()
def start_analysis():
    user_id = get_jwt_identity()
    with session_lock:
        if user_id not in video_sessions or 'filepath' not in video_sessions[user_id]:
            return jsonify({"error": "No video uploaded for this session"}), 400
        filepath = video_sessions[user_id]['filepath']
        try:
            cap = cv2.VideoCapture(filepath)
            if not cap.isOpened(): raise IOError("Could not open video file")
        except Exception as e:
             return jsonify({"error": f"Error opening video: {e}"}), 500
        video_sessions[user_id].update({
            'cap': cap, 'current_frame': 0,
            'total_frames': int(cap.get(cv2.CAP_PROP_FRAME_COUNT)), 'heatmap': None,
            'tracker': create_tracker() # *** FIX: Create a fresh tracker for this session ***
        })
    return jsonify({"message": "Analysis started", "total_frames": video_sessions[user_id]['total_frames']}), 200

@app.route('/api/analysis/frame', methods=['GET'])
@jwt_required()
def get_frame_data():
    if model is None: return jsonify({"error": "YOLO model is not loaded. Check server logs."}), 500
    user_id = get_jwt_identity()
    with session_lock:
        if user_id not in video_sessions or 'cap' not in video_sessions.get(user_id, {}):
            return jsonify({"error": "Analysis not started or session expired"}), 400
        
        sess = video_sessions[user_id]
        cap = sess.get('cap')
        tracker = sess.get('tracker')
        
        if not cap or not cap.isOpened() or not tracker:
             return jsonify({"end_of_stream": True, "message": "Video capture or tracker is not available."}), 200

        ret, frame = cap.read()
        if not ret:
            cap.release()
            if user_id in video_sessions: del video_sessions[user_id]
            return jsonify({"end_of_stream": True}), 200

        sess['current_frame'] += 1
        results = model(frame, classes=[0], verbose=False)
        detections = []
        for r in results:
            for box in r.boxes:
                (x1, y1, x2, y2), conf, cls = box.xyxy[0].tolist(), box.conf[0].item(), box.cls[0].item()
                detections.append(([int(x1), int(y1), int(x2 - x1), int(y2 - y1)], conf, int(cls)))

        tracks = tracker.update_tracks(detections, frame=frame)
        if sess.get('heatmap') is None: sess['heatmap'] = np.zeros((frame.shape[0], frame.shape[1]), dtype=np.float32)
        
        db = read_db()
        user_zones = db['zones'].get(user_id, [])
        zone_counts_data = {zone['id']: {"name": zone['name'], "count": 0} for zone in user_zones}
        total_count = 0

        for track in tracks:
            if not track.is_confirmed() or track.time_since_update > 1: continue
            total_count += 1
            track_id = track.track_id
            x1, y1, x2, y2 = map(int, track.to_ltrb())
            
            # Draw the track_id on the frame
            cv2.rectangle(frame, (x1, y1), (x2, y2), (0, 255, 0), 2)
            cv2.putText(frame, f"ID:{track_id}", (x1, y1 - 10), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (255, 255, 255), 2)
            
            center_x, center_y = int((x1 + x2) / 2), y2
            if 0 <= center_y < frame.shape[0] and 0 <= center_x < frame.shape[1]:
                sess['heatmap'][center_y - 5 : center_y + 5, center_x - 5 : center_x + 5] += 1
            for zone in user_zones:
                zone_poly = np.array([[(p['x'] / 1000) * frame.shape[1], (p['y'] / 1000) * frame.shape[0]] for p in zone['coordinates']], np.int32)
                if cv2.pointPolygonTest(zone_poly, (center_x, center_y), False) >= 0:
                    zone_counts_data[zone['id']]['count'] += 1

        _, buffer = cv2.imencode('.jpg', frame)
        frame_b64 = base64.b64encode(buffer).decode('utf-8')

        heatmap_normalized = cv2.normalize(sess['heatmap'], None, 0, 255, cv2.NORM_MINMAX, dtype=cv2.CV_8U)
        heatmap_colored = cv2.applyColorMap(heatmap_normalized, cv2.COLORMAP_JET)
        
        _, buffer_heatmap = cv2.imencode('.jpg', heatmap_colored)
        heatmap_b64 = base64.b64encode(buffer_heatmap).decode('utf-8')

    return jsonify({
        "frame_base64": frame_b64, "heatmap_base64": heatmap_b64,
        "current_frame": sess['current_frame'], "total_frames": sess['total_frames'],
        "current_count": total_count, "zone_data": zone_counts_data,
        "end_of_stream": False
    }), 200

@app.route('/')
def index():
    return render_template('dashboard.html')

@app.route('/login')
def login_page():
    return render_template('index.html')

if __name__ == "__main__":
    app.run(debug=True, threaded=True)
