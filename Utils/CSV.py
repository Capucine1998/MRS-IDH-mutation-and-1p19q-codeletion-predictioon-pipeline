import os
import pandas as pd


def save_to_csv(data, file_path):
    """Writes concentration data to an Excel file."""
    df = pd.DataFrame(data)
    df.drop(columns=['met', 'cormat'], errors='ignore', inplace=True)
    os.makedirs(os.path.dirname(file_path), exist_ok=True)  # Ensure output directory exists
    df.to_csv(file_path, index=False)
    print(f"✅ Results written to: {file_path}")