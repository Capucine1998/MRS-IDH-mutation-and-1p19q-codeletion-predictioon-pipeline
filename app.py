from flask import Flask, request, jsonify, send_file, abort
from flask import send_from_directory
import subprocess
import os
import shutil
import uuid
from flask_cors import CORS
from werkzeug.utils import secure_filename
import os
from pathlib import Path
import glob
import zipfile
from io import BytesIO
import time
import traceback

# Flask app setup
app = Flask(__name__)
UPLOAD_FOLDER = 'users'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
USER_FOLDER_LIMIT = 5

CORS(app, resources={r"/*": {"origins": "*"}})  # Allow all origins for CORS

def cleanup_old_folders():
    user_folders = [f for f in os.listdir(UPLOAD_FOLDER) if os.path.isdir(os.path.join(UPLOAD_FOLDER, f))]
    if len(user_folders) > USER_FOLDER_LIMIT:
        oldest_folder = min(user_folders, key=lambda f: os.path.getctime(os.path.join(UPLOAD_FOLDER, f)))
        shutil.rmtree(os.path.join(UPLOAD_FOLDER, oldest_folder))

def sanitize_path(path):
    base_path = "/home/mouette/websites/idh-mrs-classifier/"
    return path.replace(base_path, '')

# @app.route('/run-processing', methods=['POST'])
# def run_processing():
#     try:
#         print("\n=== Starting Processing ===")
#         dcm_files = request.files.getlist('dcmFiles')
#         water_dcm_files = request.files.getlist('waterDcmFiles')

#         temp_dir = '/home/mouette/websites/idh-mrs-classifier/temp_uploads'
#         os.makedirs(temp_dir, exist_ok=True)

#         dcm_paths = []
#         for file in dcm_files:
#             filename = secure_filename(file.filename)
#             file_path = os.path.join(temp_dir, filename)
#             file.save(file_path)
#             dcm_paths.append(file_path)

#         water_dcm_paths = []
#         for file in water_dcm_files:
#             filename = secure_filename(file.filename)
#             file_path = os.path.join(temp_dir, filename)
#             file.save(file_path)
#             water_dcm_paths.append(file_path)

        
#         print(f"Current working directory: {os.getcwd()}")
#         print(f"Script directory: {os.path.dirname(__file__)}")
#         print(f"Looking for PDFs in: {pdf_dirs}")
        
#         result = subprocess.run(
#             ['python', 'preprocessing/MRS_process.py', ' '.join(dcm_paths), ' '.join(water_dcm_paths)],
#             capture_output=True, text=True,
#             cwd=os.path.dirname(__file__),
#             timeout=300
#         )

#         pdf_dirs = [
#             'preprocessing/fitting/LCModel/output/mega_diff',
#             'preprocessing/fitting/LCModel/output/mega_off',
#             'preprocessing/fitting/LCModel/output/press',
#             'preprocessing/fitting/LCModel/output/steam'
#         ]

#         pdf_files = []
#         base_search_path = os.path.join(os.path.dirname(__file__), 'preprocessing/fitting/LCModel/output')
#         print(f"Base search path: {base_search_path}")

#         for root, dirs, files in os.walk(base_search_path):
#             print(f"Scanning: {root}")
#             for file in files:
#                 if file.endswith('.pdf'):
#                     rel_path = os.path.relpath(os.path.join(root, file), base_search_path)
#                     print(f"Found PDF: {rel_path}")
#                     pdf_files.append(rel_path)

#         if not pdf_files:
#             print("No PDFs found. Directory contents:")
#             for root, dirs, files in os.walk(base_search_path):
#                 print(f"{root}: {files}")

#         lcmodel_files = []
#         for d in pdf_dirs:
#             full_dir = os.path.join(os.path.dirname(__file__), d)
#             if os.path.exists(full_dir):
#                 for ext in ['*.COORD', '*.PRINT']:
#                     for f in glob.glob(os.path.join(full_dir, ext)):
#                         rel_path = os.path.relpath(f, os.path.join(os.path.dirname(__file__), 'preprocessing/fitting/LCModel/output'))
#                         lcmodel_files.append(rel_path)

#         # Include report if it exists
#         report_dir = os.path.join(os.path.dirname(__file__), 'preprocessing', 'results', 'report')
#         report_files = []
#         report_main_html = None

#         if os.path.exists(report_dir):
#             for f in os.listdir(report_dir):
#                 if f.endswith('.html') or f.endswith('.png'):
#                     report_files.append(f)
#                     if not report_main_html and f.lower().endswith('.html'):
#                         report_main_html = f"preprocessing/results/report/{f}"  # relative path
        
        
#         try:
#             for file_path in dcm_paths + water_dcm_paths:
#                 if os.path.exists(file_path):
#                     os.remove(file_path)
#             print("Cleaned up temporary files")
#         except Exception as e:
#             print(f"Warning: Failed to clean up temp files: {e}")
            
            
#         return jsonify({
#             'status': 'success',
#             'output': result.stdout,
#             'logs': result.stdout + result.stderr,
#             'pdfs': pdf_files,
#             'lcmodel_files': lcmodel_files,
#             'report': report_main_html,         # ✅ main HTML report for iframe
#             'report_files': report_files        # ✅ list of all downloadable files
#         })
        

#     except Exception as e:
#         print(f"\n!!! Pipeline failed: {str(e)}")
#         print(traceback.format_exc())
#         return jsonify({
#             'status': 'error',
#             'message': str(e)
#         }), 500


@app.route('/run-processing', methods=['POST'])
def run_processing():
    # Initialize all variables at the start
    pdf_dirs = [
        'preprocessing/fitting/LCModel/output/mega_diff',
        'preprocessing/fitting/LCModel/output/mega_off',
        'preprocessing/fitting/LCModel/output/press',
        'preprocessing/fitting/LCModel/output/steam'
    ]
    report_dir = os.path.join(os.path.dirname(__file__), 'preprocessing', 'results', 'report')
    
    dcm_paths = []
    water_dcm_paths = []
    pdf_files = []
    lcmodel_files = []
    report_files = []
    report_main_html = None

    try:
        print("\n=== Starting Processing ===")
        print(f"Current working directory: {os.getcwd()}")
        print(f"Script directory: {os.path.dirname(__file__)}")
        print(f"Looking for PDFs in: {pdf_dirs}")

        # File handling
        dcm_files = request.files.getlist('dcmFiles')
        water_dcm_files = request.files.getlist('waterDcmFiles')
        print(f"Received {len(dcm_files)} DCM files and {len(water_dcm_files)} water reference files")

        temp_dir = '/home/mouette/websites/idh-mrs-classifier/temp_uploads'
        os.makedirs(temp_dir, exist_ok=True)
        print(f"Using temp directory: {temp_dir}")

        for file in dcm_files:
            filename = secure_filename(file.filename)
            file_path = os.path.join(temp_dir, filename)
            file.save(file_path)
            dcm_paths.append(file_path)

        for file in water_dcm_files:
            filename = secure_filename(file.filename)
            file_path = os.path.join(temp_dir, filename)
            file.save(file_path)
            water_dcm_paths.append(file_path)

        # Run processing
        cmd = ['python', 'preprocessing/MRS_process.py', ' '.join(dcm_paths), ' '.join(water_dcm_paths)]
        print(f"\nExecuting command: {' '.join(cmd)}")
        
        result = subprocess.run(
            cmd,
            capture_output=True,
            text=True,
            cwd=os.path.dirname(__file__)  # Run from application root
        )

        print("\nSubprocess completed")
        print(f"Return code: {result.returncode}")
        print("=== STDOUT ===")
        print(result.stdout)
        print("=== STDERR ===")
        print(result.stderr)

        
        pdf_files = []
        lcmodel_files = []
        report_files = []
        report_main_html = None
        
        output_base = os.path.join(os.path.dirname(__file__), 'preprocessing/fitting/LCModel/output')
        # Check for output files
        if os.path.exists(output_base):
            for d in pdf_dirs:
                full_dir = os.path.join(output_base, d.split('/')[-1])  # Get just the mega_diff/mega_off part
                if os.path.exists(full_dir):
                    for f in glob.glob(os.path.join(full_dir, '*.pdf')):
                        rel_path = os.path.relpath(f, output_base)
                        pdf_files.append(rel_path)

        # 2. Check for report outputs (maintain your existing report container)
        if os.path.exists(report_dir):
            for f in os.listdir(report_dir):
                if f.endswith(('.html', '.png')):
                    report_files.append(f)
                    if not report_main_html and f.lower().endswith('.html'):
                        report_main_html = f"preprocessing/results/report/{f}"

        # 3. Prepare response - maintain both PDF and report outputs
        response_data = {
            'status': 'success',
            'output': result.stdout,
            'logs': result.stdout + result.stderr,
            'pdfs': pdf_files or ["No PDF output found"],
            'lcmodel_files': lcmodel_files,
            'report': report_main_html,  # This maintains your report container
            'report_files': report_files
        }

        # If no PDFs found but report exists, still return success
        if not pdf_files and report_main_html:
            response_data['message'] = "Processing completed (report generated but no PDFs found)"
        
        return jsonify(response_data)

    except Exception as e:
        print(f"\n!!! Pipeline failed: {str(e)}")
        print(traceback.format_exc())
        
        # Cleanup even if error occurs
        try:
            for file_path in dcm_paths + water_dcm_paths:
                if os.path.exists(file_path):
                    os.remove(file_path)
        except:
            pass
            
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500




@app.route('/run-classifier', methods=['POST'])
def run_classifier():
    try:
        user_folder = os.path.join(app.config['UPLOAD_FOLDER'], str(uuid.uuid4()))
        os.makedirs(user_folder, exist_ok=True)

        cleanup_old_folders()

        fields = {
            'coordFilesOff': 'coord_off',
            'printFilesOff': 'print_off',
            'coordFilesDiff': 'coord_diff',
            'printFilesDiff': 'print_diff'
        }

        file_paths = {}
        args = ['python3', 'IDH_classifier/Classifier.py', user_folder]

        for field_name, subdir in fields.items():
            uploaded_files = request.files.getlist(field_name)
            form_paths = request.form.getlist(field_name)

            # Use uploaded files if present
            if uploaded_files:
                
                target_dir = os.path.join(user_folder, subdir)
                os.makedirs(target_dir, exist_ok=True)

                saved_paths = []
                for f in uploaded_files:
                    filename = secure_filename(f.filename)
                    save_path = os.path.join(target_dir, filename)
                    f.save(save_path)
                    saved_paths.append(save_path)

                file_paths[field_name] = sorted(saved_paths)
                args.append(','.join(file_paths[field_name]))

            # Otherwise fall back to form string paths
            elif form_paths:
                existing_paths = [
                    os.path.join(app.config['UPLOAD_FOLDER'], path) for path in form_paths
                ]
                file_paths[field_name] = sorted(existing_paths)
                args.append(','.join(existing_paths))

            # Required MEGA_OFF validation
            elif field_name.startswith("coordFilesOff") or field_name.startswith("printFilesOff"):
                return jsonify({"error": f"Missing required MEGA_OFF files: {field_name}"}), 400

            else:
                args.append('')  # optional MEGA_DIFF

        print(f"🔁 Running script with args: {args}")

        result = subprocess.run(args, capture_output=True, text=True)

        print("STDOUT:", result.stdout)
        print("STDERR:", result.stderr)

        if result.returncode == 0:
            return jsonify({
                "output": sanitize_path(result.stdout),
                "user_folder": user_folder
            }), 200
        else:
            return jsonify({
                "error": sanitize_path(result.stderr),
                "user_folder": user_folder
            }), 500

    except Exception as e:
        return jsonify({"error": str(e)}), 500

@app.route('/lcmodel-files/<path:filename>')
def serve_lcmodel_files(filename):
    # This will serve files from fitting/LCModel/output/ and its subfolders
    lcmodel_root = os.path.join(os.path.dirname(__file__), 'preprocessing/fitting/LCModel/output')
    return send_from_directory(lcmodel_root, filename)

@app.route('/run-second-classifier', methods=['POST'])
def run_second_classifier():
    print("SECOND CLASSIFIER ENDPOINT HIT!")
    try:
        # Validate input
        data = request.get_json()
        if not data or 'user_folder' not in data:
            return jsonify({'error': 'Missing user_folder parameter'}), 400

        user_folder = data.get('user_folder')
        full_user_folder = os.path.join(app.config['UPLOAD_FOLDER'], user_folder)
        
        if not os.path.exists(full_user_folder):
            return jsonify({'error': f'User folder not found: {full_user_folder}'}), 404

        # Prepare diagnostics directory
        diag_dir = os.path.join(full_user_folder, "diagnostics")
        os.makedirs(diag_dir, exist_ok=True)

        # Check for IDH predictions first
        idh_files = glob.glob(os.path.join(diag_dir, "predictions_mega_off*.csv"))

        print("🧪 Checking IDH predictions in:", diag_dir)
        print("🧪 Found:", idh_files)

        if not idh_files:
            return jsonify({
                'status': 'success',
                'message': 'No IDH mutant cases found (no predictions to process)'
            }), 200

        # Check if there are actually any IDH mutant cases
        has_idh_mutant = False
        for idh_file in idh_files:
            print(f"📄 Contents of {idh_file}:")
            with open(idh_file, 'r') as f:
                lines = f.readlines()
                headers = lines[0].strip().split(',')
                try:
                    pred_idx = headers.index('Final_Prediction')
                    for line in lines[1:]:
                        if line.strip() and 'idh mutant' in line.lower():
                            has_idh_mutant = True
                            break
                except ValueError:
                    continue
            if has_idh_mutant:
                break

        if not has_idh_mutant:
            return jsonify({
                'status': 'success',
                'message': 'No IDH mutant cases found in predictions'
            }), 200

        # Run the classifier only if we have IDH mutant cases
        result = subprocess.run(
            ['python3', 'IDH_classifier/1p_19q_Classifier.py', full_user_folder],
            capture_output=True,
            text=True
        )

        # Log the full output for debugging
        print("Second classifier output:")
        print("STDOUT:", result.stdout)
        print("STDERR:", result.stderr)

        # Handle results
        if result.returncode != 0:
            error_msg = result.stderr or "Unknown error in second classifier"
            return jsonify({
                'error': error_msg,
                'details': result.stdout
            }), 500

        # Find the generated prediction file
        pred_files = sorted(glob.glob(os.path.join(diag_dir, "predictions_1p_19q_codeletion*.csv")))
        print("🧪 Looking for 1p/19q CSVs in:", diag_dir)
        print("🧪 Found:", pred_files)

        if not pred_files:
            return jsonify({'error': 'Prediction CSV not generated'}), 500

        # Wait for the file to be fully written
        latest_pred = pred_files[-1]
        while not os.path.exists(latest_pred):
            time.sleep(0.1)  # Wait for 100ms

        return jsonify({
            'status': 'success',
            'predictions_csv': os.path.relpath(latest_pred, start=app.config['UPLOAD_FOLDER']),
            'user_folder': user_folder
        }), 200

    except Exception as e:
        return jsonify({'error': str(e), 'type': type(e).__name__}), 500


@app.route('/download/<path:filename>', methods=['GET'])
def download_file(filename):
    user_folder = request.args.get('user_folder')
    file_path = os.path.join(user_folder, filename)
    if os.path.exists(file_path):
        return send_file(file_path, as_attachment=True)
    else:
        return jsonify({"error": "File not found"}), 404

@app.route('/cleanup', methods=['POST'])
def cleanup():
    user_folder = request.json.get('user_folder')
    if os.path.exists(user_folder):
        shutil.rmtree(user_folder)
    return jsonify({"message": "User folder cleaned up"}), 200

@app.route("/list-sd-plots/<user_folder>")
def list_sd_plots(user_folder):
    folder = Path(f"users/{user_folder}/results/mega_press/sd_plots")
    if not folder.exists():
        return jsonify([])

    htmls = sorted([f.name for f in folder.glob("*.html")])
    urls = [f"/users/{user_folder}/results/mega_press/sd_plots/{html}" for html in htmls]
    return jsonify(urls)


@app.route('/')
def index():
    return send_from_directory('static', 'index.html')

@app.route('/static/<path:filename>')
def static_files(filename):
    return send_from_directory('static', filename)

@app.route('/users/<path:filename>')
def serve_user_files(filename):
    base = app.config['UPLOAD_FOLDER'] 
    return send_from_directory(base, filename)

# @app.route('/users/<path:filename>')
# def serve_user_output_file(filename):
#     full_path = os.path.join(app.config['UPLOAD_FOLDER'], filename)
#     print(f"Serving file: {full_path}")
#     if not os.path.isfile(full_path):
#         return "File not found", 404
#     return send_from_directory(app.config['UPLOAD_FOLDER'], filename)


@app.route('/pdfs/<path:filename>')
def serve_pdf(filename):
    # This will serve files from fitting/LCModel/output/ and its subfolders
    pdf_root = os.path.join(os.path.dirname(__file__), 'preprocessing/fitting/LCModel/output')
    return send_from_directory(pdf_root, filename)

@app.route('/report/<path:filename>')
def serve_report(filename):
    # This will serve files from fitting/LCModel/output/ and its subfolders
    report_root = os.path.join(os.path.dirname(__file__), 'preprocessing/results/report')
    return send_from_directory(report_root, filename)


@app.route('/download-mega/<category>')
def download_mega_category(category):
    base_dir = os.path.join("preprocessing", "fitting", "LCModel", "output", category)

    if not os.path.exists(base_dir):
        return abort(404, description="Category folder not found")

    try:
        # ⏳ Stream zip to memory
        memory_file = BytesIO()
        with zipfile.ZipFile(memory_file, 'w', zipfile.ZIP_DEFLATED) as zf:
            for fname in os.listdir(base_dir):
                fpath = os.path.join(base_dir, fname)
                if os.path.isfile(fpath):
                    zf.write(fpath, arcname=fname)

        memory_file.seek(0)  # Important before send
        return send_file(
            memory_file,
            mimetype='application/zip',
            download_name=f"{category}.zip",
            as_attachment=True
        )
    except Exception as e:
        return abort(500, description=f"Error creating ZIP: {e}")

@app.route('/plots/<user_folder>/<plot_name>')
def serve_plot(user_folder, plot_name):
    plot_dir = os.path.join(app.config['UPLOAD_FOLDER'], user_folder, 'plots')
    plot_path = os.path.join(plot_dir, plot_name)
    print(f"Serving plot: {plot_path}")  # Debugging line
    return send_from_directory(plot_dir, plot_name)

# @app.route('/analysis-plots', methods=['POST'])
# def get_plots():
#     user_folder = request.json.get('user_folder')
#     print("Received user_folder:", user_folder)  # Debugging line

#     if not user_folder:
#         return jsonify({"error": "user_folder not provided"}), 400

#     user_folder_path = os.path.join(app.config['UPLOAD_FOLDER'], user_folder)
#     print("User folder path:", user_folder_path)  # Debugging line

#     if not os.path.exists(user_folder_path):
#         return jsonify({"error": "User folder not found"}), 404

#     # Check for the existence of the specific plot files
#     concentration_plot = os.path.join(user_folder_path, "plots", "concentration_plot.html")
#     ratio_plot = os.path.join(user_folder_path, "plots", "ratio_plot.html")
#     heatmap_plot = os.path.join(user_folder_path, "plots", "heatmap_plot.html")
#     spectra_plot = os.path.join(user_folder_path, "plots", "spectra_plot.html")

#     # Verify if the plot files exist
#     plots_exist = {
#         "concentration_plot": os.path.exists(concentration_plot),
#         "ratio_plot": os.path.exists(ratio_plot),
#         "heatmap_plot": os.path.exists(heatmap_plot),
#         "spectra_plot": os.path.exists(spectra_plot)
#     }
#     print("Plots exist:", plots_exist)  # Debugging line

#     if not any(plots_exist.values()):
#         return jsonify({"error": "No plots found for the given user folder"}), 404

#     # Otherwise, return the URLs of the existing plots
#     return jsonify({
#         "status": "success",
#         "plots": {
#             "concentration_plot": f"/plots/{os.path.basename(user_folder)}/concentration_plot.html",
#             "ratio_plot": f"/plots/{os.path.basename(user_folder)}/ratio_plot.html",
#             "heatmap_plot": f"/plots/{os.path.basename(user_folder)}/heatmap_plot.html",
#             "spectra_plot": f"/plots/{os.path.basename(user_folder)}/spectra_plot.html"
#         }
#     }), 200
     
@app.route('/analysis-plots', methods=['POST'])
def get_plots():
    user_folder = request.json.get('user_folder')
    if not user_folder:
        return jsonify({"error": "user_folder not provided"}), 400

    user_folder_path = os.path.join(app.config['UPLOAD_FOLDER'], user_folder)
    plots_path = os.path.join(user_folder_path, "plots")

    if not os.path.exists(plots_path):
        return jsonify({"error": "User folder not found"}), 404

    # Dynamically list patient-specific concentration plots
    concentration_plots = [
        f"/plots/{user_folder}/{f}"
        for f in os.listdir(plots_path)
        if f.endswith('_concentration_plot.html')
    ]

    plots_response = {
        "heatmap_plot": f"/plots/{user_folder}/heatmap_plot.html" if os.path.exists(os.path.join(plots_path, "heatmap_plot.html")) else None,
        "ratio_plot": f"/plots/{user_folder}/ratio_plot.html" if os.path.exists(os.path.join(plots_path, "ratio_plot.html")) else None,
        "spectra_plot": f"/plots/{user_folder}/spectra_plot.html" if os.path.exists(os.path.join(plots_path, "spectra_plot.html")) else None,
        "concentration_plot": concentration_plots  # ✅ now a list
    }

    return jsonify({
        "status": "success",
        "plots": plots_response
    }), 200


if __name__ == '__main__':
    app.run(host='0.0.0.0',debug=True, port=5000)




