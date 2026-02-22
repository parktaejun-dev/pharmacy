import cv2
import numpy as np
import glob
import os

def get_yolo_format(bbox, img_w, img_h):
    x, y, w, h = bbox
    xc = (x + w/2) / img_w
    yc = (y + h/2) / img_h
    wn = w / img_w
    hn = h / img_h
    return f"0 {xc:.6f} {yc:.6f} {wn:.6f} {hn:.6f}"

def non_max_suppression(boxes, overlapThresh):
    if len(boxes) == 0:
        return []
    
    if boxes.dtype.kind == "i":
        boxes = boxes.astype("float")
    
    pick = []
    x1 = boxes[:,0]
    y1 = boxes[:,1]
    x2 = boxes[:,0] + boxes[:,2]
    y2 = boxes[:,1] + boxes[:,3]
    
    area = (x2 - x1 + 1) * (y2 - y1 + 1)
    idxs = np.argsort(y2)
    
    while len(idxs) > 0:
        last = len(idxs) - 1
        i = idxs[last]
        pick.append(i)
        
        xx1 = np.maximum(x1[i], x1[idxs[:last]])
        yy1 = np.maximum(y1[i], y1[idxs[:last]])
        xx2 = np.minimum(x2[i], x2[idxs[:last]])
        yy2 = np.minimum(y2[i], y2[idxs[:last]])
        
        w = np.maximum(0, xx2 - xx1 + 1)
        h = np.maximum(0, yy2 - yy1 + 1)
        
        overlap = (w * h) / area[idxs[:last]]
        
        idxs = np.delete(idxs, np.concatenate(([last], np.where(overlap > overlapThresh)[0])))
        
    return boxes[pick].astype("int")

def auto_label(image_path):
    img = cv2.imread(image_path)
    if img is None:
        return
        
    h_img, w_img = img.shape[:2]
    scale = 1.0
    if w_img > 1920:
        scale = 1920 / w_img
        proc_img = cv2.resize(img, (int(w_img * scale), int(h_img * scale)))
    else:
        proc_img = img.copy()
        
    hsv = cv2.cvtColor(proc_img, cv2.COLOR_BGR2HSV)
    
    # Restrict detection to the bottom 55% only! (Avoids text and plastic seals)
    y_cutoff = int(proc_img.shape[0] * 0.45)
    
    # We create masks for the known pill colors
    lower_white = np.array([0, 0, 150])
    upper_white = np.array([180, 50, 255])
    mask_white = cv2.inRange(hsv, lower_white, upper_white)
    
    lower_yellow = np.array([20, 60, 150])
    upper_yellow = np.array([45, 255, 255])
    mask_yellow = cv2.inRange(hsv, lower_yellow, upper_yellow)
    
    lower_blue = np.array([90, 40, 140])
    upper_blue = np.array([140, 255, 255])
    mask_blue = cv2.inRange(hsv, lower_blue, upper_blue)
    
    mask = cv2.bitwise_or(mask_white, mask_yellow)
    mask = cv2.bitwise_or(mask, mask_blue)
    mask[:y_cutoff, :] = 0  # CRITICAL: Eliminate top region from mask
    
    kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, kernel, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, kernel, iterations=2)
    
    v_channel = hsv[:, :, 2]
    v_channel[:y_cutoff, :] = 0 # CRITICAL: Eliminate top region from Hough input
    
    blurred = cv2.GaussianBlur(v_channel, (9, 9), 2)
    
    # We use aggressive minDist (to catch touching pills) and rely on NMS to clean up
    circles = cv2.HoughCircles(
        blurred, 
        cv2.HOUGH_GRADIENT, 
        dp=1.2, 
        minDist=20,     # Reduced strongly to catch overlapping
        param1=50, 
        param2=15,      # Drop to find all weak edges
        minRadius=20, 
        maxRadius=60
    )
    
    raw_boxes = []
    
    if circles is not None:
        circles = np.round(circles[0, :]).astype("int")
        for (x, y, r) in circles:
            padding = int(r * 0.15)
            orig_x = int((x - r - padding) / scale)
            orig_y = int((y - r - padding) / scale)
            orig_w = int((r * 2 + padding * 2) / scale)
            orig_h = int((r * 2 + padding * 2) / scale)
            
            orig_x = max(0, orig_x)
            orig_y = max(0, orig_y)
            orig_w = min(w_img - orig_x, orig_w)
            orig_h = min(h_img - orig_y, orig_h)
            
            raw_boxes.append([orig_x, orig_y, orig_w, orig_h])
                
    # Apply NMS to remove duplicates due to tight minDist
    final_boxes = []
    if len(raw_boxes) > 0:
        raw_boxes = np.array(raw_boxes)
        nms_boxes = non_max_suppression(raw_boxes, overlapThresh=0.45)
        
        # Now we have perfectly tight boxes, but let's make sure we have around 50 pills max.
        # We can also visually verify.
        for bbox in nms_boxes:
            orig_x, orig_y, orig_w, orig_h = bbox
            final_boxes.append(bbox)
            cv2.rectangle(img, (orig_x, orig_y), (orig_x+orig_w, orig_y+orig_h), (0, 255, 0), 4)
            
    base_name = os.path.basename(image_path)
    name, ext = os.path.splitext(base_name)
    verify_path = os.path.join(os.path.dirname(image_path), f"verify_final_{name}_annotated{ext}")
    cv2.imwrite(verify_path, img)
    
    label_path = os.path.join(os.path.dirname(image_path), f"{name}.txt")
    with open(label_path, 'w') as f:
        for bbox in final_boxes:
            f.write(get_yolo_format(bbox, w_img, h_img) + "\n")
            
    print(f"Processed {base_name}: Found {len(final_boxes)} pills.")

if __name__ == '__main__':
    dataset_dir = "/Users/parktaejun/coding/pharmacy/dataset"
    for img_file in glob.glob(os.path.join(dataset_dir, "*.jpg")):
        if "annotated" in img_file:
            continue
        auto_label(img_file)
