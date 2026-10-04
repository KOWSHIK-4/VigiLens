from ultralytics import YOLO
m = YOLO("yolo11n.pt")
img = r"C:\Users\S A KOWSHIK\VigiLens\ai\.venv\Lib\site-packages\ultralytics\assets\bus.jpg"
r = m(img, verbose=False)[0]
print("classes detected:", len(r.boxes))
for b in r.boxes:
    cid = int(b.cls[0]); conf = float(b.conf[0])
    print(f"  cls={cid} name={r.names[cid]} conf={conf:.4f} xyxy={[int(v) for v in b.xyxy[0]]}")
