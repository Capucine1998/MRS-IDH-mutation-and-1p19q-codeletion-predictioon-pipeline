import os
import shutil

def clean_directory(path):
    if os.path.exists(path):
        for root, dirs, files in os.walk(path, topdown=False):
            for file in files:
                os.remove(os.path.join(root, file))
            for dir in dirs:
                shutil.rmtree(os.path.join(root, dir))
    else:
        os.makedirs(path)
