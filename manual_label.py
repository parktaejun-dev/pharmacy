import os
import glob
import tkinter as tk
from tkinter import messagebox
from PIL import Image, ImageTk

# YOLO format: class x_center y_center width height
# Class 0: pill

class YoloLabeler:
    def __init__(self, master, image_dir):
        self.master = master
        self.master.title("YOLO Ground Truth Labeler")
        
        self.image_dir = image_dir
        self.image_files = [f for f in glob.glob(os.path.join(image_dir, "*.jpg")) if "annotated" not in f and "aug_" not in f]
        self.current_idx = 0
        
        if not self.image_files:
            messagebox.showerror("Error", "No images found in dataset directory.")
            self.master.destroy()
            return
            
        self.bboxes = [] # (x1, y1, x2, y2) pixel coords
        self.start_x = None
        self.start_y = None
        self.current_rect = None
        self.rect_ids = []
        
        # UI Elements
        self.top_frame = tk.Frame(master)
        self.top_frame.pack(fill=tk.X, padx=5, pady=5)
        
        self.info_lbl = tk.Label(self.top_frame, text="")
        self.info_lbl.pack(side=tk.LEFT)
        
        self.btn_clear = tk.Button(self.top_frame, text="Clear Current Image (C)", command=self.clear_all)
        self.btn_clear.pack(side=tk.RIGHT, padx=5)
        
        self.btn_save_next = tk.Button(self.top_frame, text="Save & Next (Space)", command=self.save_and_next)
        self.btn_save_next.pack(side=tk.RIGHT, padx=5)
        
        self.canvas = tk.Canvas(master, cursor="cross")
        self.canvas.pack(fill=tk.BOTH, expand=True)
        
        # Bindings
        self.canvas.bind("<ButtonPress-1>", self.on_press)
        self.canvas.bind("<B1-Motion>", self.on_drag)
        self.canvas.bind("<ButtonRelease-1>", self.on_release)
        self.master.bind("<space>", lambda e: self.save_and_next())
        self.master.bind("c", lambda e: self.clear_all())
        self.master.bind("z", lambda e: self.undo_last())
        
        self.load_image()
        
    def load_image(self):
        if self.current_idx >= len(self.image_files):
            messagebox.showinfo("Done", "All images labeled!")
            self.master.destroy()
            return
            
        self.img_path = self.image_files[self.current_idx]
        self.pil_img = Image.open(self.img_path)
        
        # Resize to fit screen if needed (fixed 1280 width for consistancy)
        max_w = 1200
        w, h = self.pil_img.size
        if w > max_w:
            self.scale = max_w / w
            new_w, new_h = int(w * self.scale), int(h * self.scale)
            self.disp_img = self.pil_img.resize((new_w, new_h), Image.Resampling.LANCZOS)
        else:
            self.scale = 1.0
            self.disp_img = self.pil_img
            
        self.tk_img = ImageTk.PhotoImage(self.disp_img)
        self.canvas.config(width=self.disp_img.width, height=self.disp_img.height)
        self.canvas.create_image(0, 0, anchor=tk.NW, image=self.tk_img)
        
        self.bboxes = []
        self.rect_ids = []
        self.update_info()
        
    def update_info(self):
        filename = os.path.basename(self.img_path)
        self.info_lbl.config(text=f"Image {self.current_idx+1}/{len(self.image_files)}: {filename} | Pills labeled: {len(self.bboxes)}")
        
    def on_press(self, event):
        self.start_x = event.x
        self.start_y = event.y
        self.current_rect = self.canvas.create_rectangle(self.start_x, self.start_y, self.start_x, self.start_y, outline="green", width=2)
        
    def on_drag(self, event):
        cur_x, cur_y = event.x, event.y
        self.canvas.coords(self.current_rect, self.start_x, self.start_y, cur_x, cur_y)
        
    def on_release(self, event):
        end_x, end_y = event.x, event.y
        
        # Enforce valid box
        x1, x2 = min(self.start_x, end_x), max(self.start_x, end_x)
        y1, y2 = min(self.start_y, end_y), max(self.start_y, end_y)
        
        if (x2 - x1) > 5 and (y2 - y1) > 5:
            self.bboxes.append((x1, y1, x2, y2))
            self.rect_ids.append(self.current_rect)
            self.update_info()
        else:
            self.canvas.delete(self.current_rect)
            
        self.current_rect = None

    def undo_last(self):
        if self.rect_ids:
            r_id = self.rect_ids.pop()
            self.canvas.delete(r_id)
            self.bboxes.pop()
            self.update_info()
            
    def clear_all(self):
        for r_id in self.rect_ids:
            self.canvas.delete(r_id)
        self.rect_ids.clear()
        self.bboxes.clear()
        self.update_info()
        
    def save_and_next(self):
        if not self.bboxes:
            if not messagebox.askyesno("Warning", "No boxes drawn. Skip saving and go to next?"):
                return
        else:
            # Convert to YOLO and save
            orig_w, orig_h = self.pil_img.size
            name = os.path.splitext(os.path.basename(self.img_path))[0]
            txt_path = os.path.join(self.image_dir, f"{name}.txt")
            
            with open(txt_path, 'w') as f:
                for (x1, y1, x2, y2) in self.bboxes:
                    # Restore original scale
                    ox1, oy1 = x1 / self.scale, y1 / self.scale
                    ox2, oy2 = x2 / self.scale, y2 / self.scale
                    
                    # YOLO calc
                    ow = ox2 - ox1
                    oh = oy2 - oy1
                    oxc = ox1 + (ow / 2)
                    oyc = oy1 + (oh / 2)
                    
                    yn_xc = oxc / orig_w
                    yn_yc = oyc / orig_h
                    yn_w = ow / orig_w
                    yn_h = oh / orig_h
                    
                    f.write(f"0 {yn_xc:.6f} {yn_yc:.6f} {yn_w:.6f} {yn_h:.6f}\n")
                    
        self.current_idx += 1
        self.load_image()

if __name__ == "__main__":
    dataset_dir = "/Users/parktaejun/coding/pharmacy/dataset"
    root = tk.Tk()
    
    # macOS force focus
    import platform
    if platform.system() == 'Darwin':
        os.system('''/usr/bin/osascript -e 'tell app "System Events" to set frontmost of every process whose unix id is {} to true' '''.format(os.getpid()))
        
    root.lift()
    root.attributes('-topmost', True)
    root.after_idle(root.attributes, '-topmost', False)
    
    app = YoloLabeler(root, dataset_dir)
    root.mainloop()
