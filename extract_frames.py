import cv2, os, json

video_path = r"C:\Users\leona\Videos\Screen Recordings\Screen Recording 2026-05-21 093419.mp4"
out_dir = r"C:\Users\leona\zebrastats\frames"
os.makedirs(out_dir, exist_ok=True)

cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)
total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT)
duration = total_frames / fps
width = cap.get(cv2.CAP_PROP_FRAME_WIDTH)
height = cap.get(cv2.CAP_PROP_FRAME_HEIGHT)

print(json.dumps({"fps": round(fps,2), "total_frames": int(total_frames), "duration": round(duration,1), "width": int(width), "height": int(height)}))

# Extract 1 frame every 5 seconds
timestamps = list(range(0, int(duration), 5))
saved = []
for t in timestamps:
    frame_num = int(t * fps)
    cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
    ret, frame = cap.read()
    if ret:
        scale = 960 / frame.shape[1]
        small = cv2.resize(frame, (960, int(frame.shape[0] * scale)))
        path = os.path.join(out_dir, f"frame_{t:04d}s.jpg")
        cv2.imwrite(path, small, [cv2.IMWRITE_JPEG_QUALITY, 75])
        saved.append(t)

cap.release()
print(f"Saved {len(saved)} frames at timestamps: {saved}")
