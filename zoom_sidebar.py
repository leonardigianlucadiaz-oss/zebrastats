import cv2, os

video_path = r"C:\Users\leona\Videos\Screen Recordings\Screen Recording 2026-05-21 093419.mp4"
cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)

# Frame at ~28s — sidebar open
cap.set(cv2.CAP_PROP_POS_FRAMES, int(28 * fps))
ret, frame = cap.read()

if ret:
    # Crop just the sidebar (left ~300px at original resolution)
    h, w = frame.shape[:2]
    # Sidebar is about left 300px, full height
    sidebar_crop = frame[:, :int(300 * (w / 1280) * 2), :]
    # Scale up for visibility
    scale = 2.5
    big = cv2.resize(sidebar_crop, (int(sidebar_crop.shape[1]*scale), int(sidebar_crop.shape[0]*scale)))
    cv2.imwrite(r"C:\Users\leona\zebrastats\frames\sidebar_zoom.jpg", big, [cv2.IMWRITE_JPEG_QUALITY, 92])
    print(f"Sidebar crop: {sidebar_crop.shape}, zoomed to: {big.shape}")

cap.release()
