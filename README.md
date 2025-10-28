# Crowd Count and Analysis Dashboard

This is a full-stack web application that analyzes video to count and track people in real-time. It uses computer vision to provide live data on crowd density and movement within user-defined zones.
             
-----

## Features

  * **Secure User Authentication:** Register and log in with a secure, token-based system.
  * **Video Upload:** Upload your own video files for analysis.
  * **Dynamic Zone Creation:** Draw, name, and delete zones directly on the video player.
  * **Real-time Analysis:**
      * Uses **YOLOv8** for person detection.
      * Uses **DeepSORT** for object tracking and persistent IDs.
  * **Live Dashboard:**
      * Real-time population line chart.
      * Live video feed with bounding boxes and IDs.
      * Activity heatmap generation.
      * Live zone-by-zone occupancy counts.
      * Alerts when a zone's population is too high.

-----

## Tech Stack

  * **Backend:** Python, Flask, OpenCV, Ultralytics (YOLOv8), deep-sort-realtime
  * **Frontend:** HTML, CSS, JavaScript, Chart.js
  * **Security:** Flask-JWT-Extended, Flask-Bcrypt
  * **Database:** JSON

-----

## How to Run

1.  **Clone the repository:**

    ```bash
    git clone https://github.com/RennCipher/Crowd-Count-Analytics.git
    cd Crowd-Count-Analytics
    ```

2.  **Create a virtual environment:**

    ```bash
    python -m venv venv
    .\venv\Scripts\activate
    ```

3.  **Install dependencies:**

    ```bash
    pip install -r requirements.txt
    ```

4.  **Run the app:**

    ```bash
    python app.py
    ```

5.  **Open in your browser:**
    `http://127.0.0.1:5000`