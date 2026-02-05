import os
import shutil

def cleanup_old_folders(UPLOAD_FOLDER, USER_FOLDER_LIMIT):
    user_folders = [f for f in os.listdir(UPLOAD_FOLDER) if os.path.isdir(os.path.join(UPLOAD_FOLDER, f))]
    if len(user_folders) > USER_FOLDER_LIMIT:
        oldest_folder = min(user_folders, key=lambda f: os.path.getctime(os.path.join(UPLOAD_FOLDER, f)))
        shutil.rmtree(os.path.join(UPLOAD_FOLDER, oldest_folder))

def sanitize_path(path):
    base_path = "/home/mouette/websites/idh-mrs-classifier/"
    return path.replace(base_path, '')
