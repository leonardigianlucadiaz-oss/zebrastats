import cv2, os

video_path = r"C:\Users\leona\Videos\Screen Recordings\Screen Recording 2026-05-21 093419.mp4"
out_dir = r"C:\Users\leona\zebrastats\frames"
os.makedirs(out_dir, exist_ok=True)

cap = cv2.VideoCapture(video_path)
fps = cap.get(cv2.CAP_PROP_FPS)

# Key moments where cursor indicates problems — extract 1 frame per second in these windows
segments = [
    # (start_sec, end_sec, label)
    (0, 8, "home"),          # Home - Arsenal duplicate
    (24, 33, "sidebar"),     # Hamburger sidebar content
    (62, 68, "ranking"),     # Ranking empty state
    (78, 88, "alertas"),     # Alertas layout
    (123, 132, "favoritos"), # Favoritos
    (133, 142, "perfil"),    # Perfil counter bug
]

for (start, end, label) in segments:
    for t in range(start, end+1, 1):
        frame_num = int(t * fps)
        cap.set(cv2.CAP_PROP_POS_FRAMES, frame_num)
        ret, frame = cap.read()
        if ret:
            scale = 1280 / frame.shape[1]
            small = cv2.resize(frame, (1280, int(frame.shape[0] * scale)))
            path = os.path.join(out_dir, f"detail_{label}_{t:04d}s.jpg")
            cv2.imwrite(path, small, [cv2.IMWRITE_JPEG_QUALITY, 82])

cap.release()
print("Done")
