from flask import Flask, request, jsonify, send_file, abort, Response
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
import sys
import threading
import queue
import tarfile
import json


# Flask app setup
app = Flask(__name__)
UPLOAD_FOLDER = 'users'
app.config['UPLOAD_FOLDER'] = UPLOAD_FOLDER
USER_FOLDER_LIMIT = 5

CORS(app, resources={r"/*": {"origins": "*"}})  # Allow all origins for CORS

# In-memory job store for streaming processing logs to the UI.
# NOTE: This is per-process memory. If you run multiple workers, you need shared state.
_PROCESSING_JOBS: dict[str, dict] = {}
_PROCESSING_JOBS_LOCK = threading.Lock()

# TODO: degage ca dans un util job
def _job_emit(job_id: str, message: str, event: str = 'log') -> None:
    """Push a message to a job's SSE queue (and print server-side)."""
    try:
        if message is None:
            message = ''
        msg = str(message)
    except Exception:
        msg = ''

    try:
        print(msg)
    except Exception:
        pass

    with _PROCESSING_JOBS_LOCK:
        job = _PROCESSING_JOBS.get(job_id)
        if not job:
            return
        job['queue'].put({
            'event': event,
            't': time.time(),
            'data': msg,
        })

# TODO: degage ca dans un util job
def _job_finish(job_id: str, *, result: dict | None = None, error_message: str | None = None) -> None:
    with _PROCESSING_JOBS_LOCK:
        job = _PROCESSING_JOBS.get(job_id)
        if not job:
            return
        job['finished'] = True
        if result is not None:
            job['result'] = result
        if error_message is not None:
            job['error'] = error_message

        # Schedule cleanup so we don't retain logs forever.
        if not job.get('cleanup_scheduled'):
            job['cleanup_scheduled'] = True

            def _cleanup():
                with _PROCESSING_JOBS_LOCK:
                    _PROCESSING_JOBS.pop(job_id, None)

            threading.Timer(15 * 60, _cleanup).start()

    if error_message is not None:
        _job_emit(job_id, error_message, event='job_error')
    if result is not None:
        # Send final JSON payload in a dedicated event.
        with _PROCESSING_JOBS_LOCK:
            job = _PROCESSING_JOBS.get(job_id)
            if job:
                job['queue'].put({
                    'event': 'done',
                    't': time.time(),
                    'data': result,
                })

@app.route('/processing-events/<job_id>')
def processing_events(job_id: str):
    def gen():
        with _PROCESSING_JOBS_LOCK:
            job = _PROCESSING_JOBS.get(job_id)
        if not job:
            # One-time error then end.
            yield 'event: job_error\n'
            yield 'data: ' + json.dumps({'message': 'Unknown job id'}) + '\n\n'
            return

        # Initial meta event so the UI can compute elapsed time.
        yield 'event: meta\n'
        yield 'data: ' + json.dumps({'job_id': job_id, 'started_at': job.get('started_at')}) + '\n\n'

        # Stream queue items.
        while True:
            with _PROCESSING_JOBS_LOCK:
                job = _PROCESSING_JOBS.get(job_id)
            if not job:
                break

            try:
                item = job['queue'].get(timeout=1.0)
            except queue.Empty:
                # Keep-alive comment.
                yield ': keep-alive\n\n'
                with _PROCESSING_JOBS_LOCK:
                    finished = bool(job.get('finished'))
                    empty = job['queue'].empty()
                if finished and empty:
                    break
                continue

            ev = item.get('event', 'log')
            t = item.get('t', time.time())
            data = item.get('data', '')

            if ev == 'done':
                payload = {'t': t, 'result': data}
                yield 'event: done\n'
                yield 'data: ' + json.dumps(payload) + '\n\n'
                # Let the keepalive loop exit once queue drains.
                continue
            elif ev == 'job_error':
                payload = {'t': t, 'message': str(data)}
                yield 'event: job_error\n'
                yield 'data: ' + json.dumps(payload) + '\n\n'
                continue
            elif ev == 'meta':
                yield 'event: meta\n'
                yield 'data: ' + json.dumps(data) + '\n\n'
                continue
            else:
                payload = {'t': t, 'message': str(data)}
                yield 'event: log\n'
                yield 'data: ' + json.dumps(payload) + '\n\n'

    return Response(gen(), mimetype='text/event-stream', headers={
        'Cache-Control': 'no-cache',
        'X-Accel-Buffering': 'no',
    })

# TODO: degage ca dans un util
def cleanup_old_folders():
    user_folders = [f for f in os.listdir(UPLOAD_FOLDER) if os.path.isdir(os.path.join(UPLOAD_FOLDER, f))]
    if len(user_folders) > USER_FOLDER_LIMIT:
        oldest_folder = min(user_folders, key=lambda f: os.path.getctime(os.path.join(UPLOAD_FOLDER, f)))
        shutil.rmtree(os.path.join(UPLOAD_FOLDER, oldest_folder))

# TODO: degage ca dans un util
def sanitize_path(path):
    base_path = "/home/mouette/websites/idh-mrs-classifier/"
    return path.replace(base_path, '')

@app.route('/run-processing', methods=['POST'])
def run_processing():
    # Initialize all variables at the start
    pdf_dirs = [
        'glioma_mrs_preprocessing/fitting/LCModel/output/mega_diff',
        'glioma_mrs_preprocessing/fitting/LCModel/output/mega_off',
        'glioma_mrs_preprocessing/fitting/LCModel/output/press',
        'glioma_mrs_preprocessing/fitting/LCModel/output/steam'
    ]
    report_dir = os.path.join(os.path.dirname(__file__), 'glioma_mrs_preprocessing', 'results', 'report')
    
    dcm_paths = []
    water_dcm_paths = []

    # TODO: Ces variables ne sont pas utilisés
    pdf_files = []
    lcmodel_files = []
    report_files = []
    report_main_html = None

    job_id = str(uuid.uuid4())
    with _PROCESSING_JOBS_LOCK:
        _PROCESSING_JOBS[job_id] = {
            'queue': queue.Queue(),
            'started_at': time.time(),
            'finished': False,
            'result': None,
            'error': None,
        }

    with _PROCESSING_JOBS_LOCK:
        job_started_at = float(_PROCESSING_JOBS[job_id].get('started_at') or time.time())

    try:
        _job_emit(job_id, "\n=== Starting Processing ===")
        _job_emit(job_id, f"Job id: {job_id}")
        print("\n=== Starting Processing ===")
        print(f"Current working directory: {os.getcwd()}")
        print(f"Script directory: {os.path.dirname(__file__)}")
        print(f"Looking for PDFs in: {pdf_dirs}")

        _job_emit(job_id, f"Current working directory: {os.getcwd()}")
        _job_emit(job_id, f"Script directory: {os.path.dirname(__file__)}")
        _job_emit(job_id, f"Looking for PDFs in: {pdf_dirs}")

        # Useful to distinguish "upload still streaming" vs "pipeline stuck".
        try:
            _job_emit(job_id, f"Request content length: {request.content_length} bytes")
            print(f"Request content length: {request.content_length} bytes")
        except Exception:
            pass

        # File handling
        t_parse0 = time.time()
        _job_emit(job_id, "📦 Parsing multipart upload (request.files)...")
        print("📦 Parsing multipart upload (request.files)...")
        archive_upload = request.files.get('archive')
        water_archive_upload = request.files.get('water_archive')
        dcm_files = request.files.getlist('dcmFiles')
        water_dcm_files = request.files.getlist('waterDcmFiles')
        directory_files = request.files.getlist('directoryFiles')
        _job_emit(job_id, f"📦 Multipart parsed in {time.time() - t_parse0:.2f}s")
        print(f"📦 Multipart parsed in {time.time() - t_parse0:.2f}s")

        # If client uploaded a single archive, we'll extract it and discover .dcm paths.
        # This avoids extremely slow multipart parsing when there are hundreds/thousands of parts.
        if archive_upload is None:
            # MULTI mode uploads come in as `directoryFiles`.
            # Treat them as DCM inputs if `dcmFiles` is empty.
            if (not dcm_files) and directory_files:
                dcm_files = directory_files

        if archive_upload is None:
            print(f"Received {len(dcm_files)} DCM files and {len(water_dcm_files)} water reference files")

            if not dcm_files:
                return jsonify({
                    'status': 'error',
                    'message': 'No DCM files received (check folder selection / upload fields).'
                }), 400
        else:
            _job_emit(job_id, f"Received archive upload: {archive_upload.filename!r}")
            print(f"Received archive upload: {archive_upload.filename!r}")
            if water_archive_upload is not None:
                _job_emit(job_id, f"Received water archive upload: {water_archive_upload.filename!r}")
                print(f"Received water archive upload: {water_archive_upload.filename!r}")

        # Save uploads into a per-request temp folder, preserving client relative paths.
        # This is important because the MRS pipeline groups by parent folder; flattening breaks it.
        base_temp_dir = '/home/mouette/websites/idh-mrs-classifier/temp_uploads'
        request_temp_dir = os.path.join(base_temp_dir, str(uuid.uuid4()))
        os.makedirs(request_temp_dir, exist_ok=True)
        _job_emit(job_id, f"Using temp directory: {request_temp_dir}")
        print(f"Using temp directory: {request_temp_dir}")

        def safe_save_upload(upload, root_dir):
            # upload.filename may include a relative path (e.g. "S14_xxx/IM-0001.dcm" or "S14/IM-0001.dcm")
            raw_name = upload.filename or ''
            rel = Path(raw_name)
            # Reject absolute paths and traversal
            if rel.is_absolute() or '..' in rel.parts:
                raise ValueError(f"Invalid upload filename/path: {raw_name!r}")

            safe_parts = [secure_filename(p) for p in rel.parts if p not in ('', '.')]
            if not safe_parts:
                safe_parts = [secure_filename(raw_name) or f"file_{uuid.uuid4()}" ]

            out_path = os.path.join(root_dir, *safe_parts)
            out_dir = os.path.dirname(out_path)
            os.makedirs(out_dir, exist_ok=True)

            # Ensure out_path stays within root_dir
            root_real = os.path.realpath(root_dir)
            out_real = os.path.realpath(out_path)
            if not out_real.startswith(root_real + os.sep):
                raise ValueError(f"Refusing to write outside temp dir: {raw_name!r}")

            upload.save(out_path)
            return out_path

        def safe_extract_tar(archive_fp: str, dest_dir: str) -> None:
            os.makedirs(dest_dir, exist_ok=True)
            with tarfile.open(archive_fp, mode='r:*') as tf:
                for member in tf.getmembers():
                    # Safety: no absolute paths, no traversal
                    name = member.name
                    if name.startswith('/') or name.startswith('\\'):
                        raise ValueError(f"Unsafe path in archive (absolute): {name!r}")
                    parts = [p for p in name.split('/') if p not in ('', '.')]
                    if any(p == '..' for p in parts):
                        raise ValueError(f"Unsafe path in archive (traversal): {name!r}")
                tf.extractall(path=dest_dir)

        if archive_upload is not None:
            _job_emit(job_id, "📥 Saving archive...")
            print("📥 Saving archive...")
            archive_path = os.path.join(request_temp_dir, secure_filename(archive_upload.filename or 'upload.tar.gz'))
            archive_upload.save(archive_path)

            fid_extract_dir = os.path.join(request_temp_dir, 'fid')
            _job_emit(job_id, "📦 Extracting archive...")
            print("📦 Extracting archive...")
            t_ext0 = time.time()
            safe_extract_tar(archive_path, fid_extract_dir)
            _job_emit(job_id, f"📦 Archive extracted in {time.time() - t_ext0:.2f}s")
            print(f"📦 Archive extracted in {time.time() - t_ext0:.2f}s")

            # Discover DICOM files after extraction
            _job_emit(job_id, "🔎 Discovering .dcm files in extracted archive...")
            print("🔎 Discovering .dcm files in extracted archive...")
            t_find0 = time.time()
            for root, _, files in os.walk(fid_extract_dir):
                for fn in files:
                    if fn.lower().endswith('.dcm'):
                        dcm_paths.append(os.path.join(root, fn))
            dcm_paths = sorted(dcm_paths)
            _job_emit(job_id, f"🔎 Found {len(dcm_paths)} .dcm files in {time.time() - t_find0:.2f}s")
            print(f"🔎 Found {len(dcm_paths)} .dcm files in {time.time() - t_find0:.2f}s")

            if water_archive_upload is not None:
                _job_emit(job_id, "📥 Saving water archive...")
                print("📥 Saving water archive...")
                water_archive_path = os.path.join(request_temp_dir, secure_filename(water_archive_upload.filename or 'water_upload.tar.gz'))
                water_archive_upload.save(water_archive_path)

                water_extract_dir = os.path.join(request_temp_dir, 'water')
                _job_emit(job_id, "📦 Extracting water archive...")
                print("📦 Extracting water archive...")
                t_wext0 = time.time()
                safe_extract_tar(water_archive_path, water_extract_dir)
                _job_emit(job_id, f"📦 Water archive extracted in {time.time() - t_wext0:.2f}s")
                print(f"📦 Water archive extracted in {time.time() - t_wext0:.2f}s")

                _job_emit(job_id, "🔎 Discovering .dcm files in extracted water archive...")
                print("🔎 Discovering .dcm files in extracted water archive...")
                t_wfind0 = time.time()
                for root, _, files in os.walk(water_extract_dir):
                    for fn in files:
                        if fn.lower().endswith('.dcm'):
                            water_dcm_paths.append(os.path.join(root, fn))
                water_dcm_paths = sorted(water_dcm_paths)
                _job_emit(job_id, f"🔎 Found {len(water_dcm_paths)} water .dcm files in {time.time() - t_wfind0:.2f}s")
                print(f"🔎 Found {len(water_dcm_paths)} water .dcm files in {time.time() - t_wfind0:.2f}s")
            else:
                # Backward compatible fallback: if client still sent explicit water files, save them.
                if water_dcm_files:
                    _job_emit(job_id, f"📥 Saving {len(water_dcm_files)} water reference files...")
                    print(f"📥 Saving {len(water_dcm_files)} water reference files...")
                    for i, upload in enumerate(water_dcm_files, 1):
                        water_dcm_paths.append(safe_save_upload(upload, request_temp_dir))
                        if i % 50 == 0 or i == len(water_dcm_files):
                            _job_emit(job_id, f"   ... saved {i}/{len(water_dcm_files)} water files")
                            print(f"   ... saved {i}/{len(water_dcm_files)} water files")
        else:
            _job_emit(job_id, f"📥 Saving {len(dcm_files)} DCM files...")
            print(f"📥 Saving {len(dcm_files)} DCM files...")
            for i, upload in enumerate(dcm_files, 1):
                dcm_paths.append(safe_save_upload(upload, request_temp_dir))
                if i % 50 == 0 or i == len(dcm_files):
                    _job_emit(job_id, f"   ... saved {i}/{len(dcm_files)} DCMs")
                    print(f"   ... saved {i}/{len(dcm_files)} DCMs")

            if water_dcm_files:
                _job_emit(job_id, f"📥 Saving {len(water_dcm_files)} water reference files...")
                print(f"📥 Saving {len(water_dcm_files)} water reference files...")
                for i, upload in enumerate(water_dcm_files, 1):
                    water_dcm_paths.append(safe_save_upload(upload, request_temp_dir))
                    if i % 50 == 0 or i == len(water_dcm_files):
                        _job_emit(job_id, f"   ... saved {i}/{len(water_dcm_files)} water files")
                        print(f"   ... saved {i}/{len(water_dcm_files)} water files")

        # Deterministic ordering (closest to DEBUG, which sorts paths)
        _job_emit(job_id, "📋 Sorting files...")
        print("📋 Sorting files...")
        dcm_paths = sorted(dcm_paths)
        water_dcm_paths = sorted(water_dcm_paths)
        _job_emit(job_id, "   ✓ Sorting complete")
        print("   ✓ Sorting complete")

        try:
            parent_dirs = sorted({os.path.dirname(p) for p in dcm_paths})
            _job_emit(job_id, f"✅ Upload complete: saved DCMs into {len(parent_dirs)} folder(s)")
            print(f"✅ Upload complete: saved DCMs into {len(parent_dirs)} folder(s)")
        except Exception as e:
            _job_emit(job_id, f"⚠️  Could not count folders: {e}")
            print(f"⚠️  Could not count folders: {e}")
        
        _job_emit(job_id, f"DCM file count: {len(dcm_paths)}")
        _job_emit(job_id, f"Water file count: {len(water_dcm_paths)}")

        # Start background processing job so the UI can stream logs in real time.
        def _run_job():
            try:
                _job_emit(job_id, "\n🔄 Starting pipeline (this may take several minutes for LCModel fitting)...")
                _job_emit(job_id, "   Streaming progress output below:\n")

                script_path = os.path.join(os.path.dirname(__file__), 'glioma_mrs_preprocessing', 'MRS_process.py')
                # IMPORTANT: pass paths as proper argv items.
                # Joining paths with spaces breaks when any folder/file contains spaces or special chars.
                cmd = [sys.executable, '-u', script_path, '--dcm', *dcm_paths]
                if water_dcm_paths:
                    cmd.extend(['--water', *water_dcm_paths])

                stdout_lines: list[str] = []
                stderr_lines: list[str] = []

                env = os.environ.copy()
                env['PYTHONUNBUFFERED'] = '1'
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.PIPE,
                    text=True,
                    bufsize=1,
                    cwd=os.path.dirname(__file__),
                    env=env,
                )

                q: queue.Queue[tuple[str, str]] = queue.Queue()

                def _reader(pipe, tag: str):
                    try:
                        if pipe is None:
                            return
                        for line in iter(pipe.readline, ''):
                            q.put((tag, line.rstrip('\n')))
                    finally:
                        try:
                            if pipe is not None:
                                pipe.close()
                        except Exception:
                            pass

                t_out = threading.Thread(target=_reader, args=(proc.stdout, 'PROC'), daemon=True)
                t_err = threading.Thread(target=_reader, args=(proc.stderr, 'ERR'), daemon=True)
                t_out.start()
                t_err.start()

                timeout_s = 3600
                t0 = time.time()
                last_heartbeat = 0.0

                while True:
                    now = time.time()
                    if now - t0 > timeout_s:
                        proc.kill()
                        raise ValueError("Pipeline took too long (>1 hour) - likely stuck in LCModel fitting. Check inputs or reduce dataset size.")

                    try:
                        tag, line = q.get(timeout=0.25)
                        if tag == 'PROC':
                            stdout_lines.append(line)
                        else:
                            stderr_lines.append(line)
                        _job_emit(job_id, f"  [{tag}] {line}")
                    except queue.Empty:
                        if now - last_heartbeat > 10:
                            last_heartbeat = now
                            if proc.poll() is None:
                                _job_emit(job_id, "  [PROC] ...still running...")

                    if proc.poll() is not None:
                        while True:
                            try:
                                tag, line = q.get_nowait()
                                if tag == 'PROC':
                                    stdout_lines.append(line)
                                else:
                                    stderr_lines.append(line)
                                _job_emit(job_id, f"  [{tag}] {line}")
                            except queue.Empty:
                                break
                        break

                rc = proc.returncode
                _job_emit(job_id, f"\n✅ Pipeline completed with return code: {rc}")
                if rc != 0:
                    raise ValueError(f"Pipeline failed (return code {rc}). Check stderr above.")

                result_stdout = '\n'.join(stdout_lines)
                result_stderr = '\n'.join(stderr_lines)

                pdf_files = []
                lcmodel_files = []
                report_files = []
                report_main_html = None

                def _is_new(path: str) -> bool:
                    try:
                        # small slack to account for filesystem timestamp granularity
                        return os.path.getmtime(path) >= (job_started_at - 2.0)
                    except Exception:
                        return True

                output_base = os.path.join(os.path.dirname(__file__), 'glioma_mrs_preprocessing/fitting/LCModel/output')
                if os.path.exists(output_base):
                    for d in pdf_dirs:
                        full_dir = os.path.join(output_base, d.split('/')[-1])
                        if os.path.exists(full_dir):
                            for f in glob.glob(os.path.join(full_dir, '*.pdf')):
                                if _is_new(f):
                                    rel_path = os.path.relpath(f, output_base)
                                    pdf_files.append(rel_path)

                    # Collect LCModel outputs for classifier auto-import (.COORD/.PRINT)
                    for root, _, files in os.walk(output_base):
                        for name in files:
                            if not name.upper().endswith(('.COORD', '.PRINT')):
                                continue
                            full_path = os.path.join(root, name)
                            if _is_new(full_path):
                                rel_path = os.path.relpath(full_path, output_base)
                                lcmodel_files.append(rel_path)

                    lcmodel_files = sorted(set(lcmodel_files))

                edited_spectra_html = None
                no_edit_spectra_html = None

                if os.path.exists(report_dir):
                    # Only include files created/updated during this run.
                    for f in os.listdir(report_dir):
                        if not f.endswith(('.html', '.png')):
                            continue
                        full = os.path.join(report_dir, f)
                        if _is_new(full):
                            report_files.append(f)

                    report_files = sorted(report_files)

                    html_files = [f for f in report_files if f.lower().endswith('.html')]

                    def _newest(files: list[str]) -> str | None:
                        if not files:
                            return None
                        best = None
                        best_m = None
                        for name in files:
                            try:
                                m = os.path.getmtime(os.path.join(report_dir, name))
                            except Exception:
                                m = 0
                            if best is None or m > (best_m or 0):
                                best = name
                                best_m = m
                        return best

                    edited_candidates = [f for f in html_files if f.lower().endswith('_edited_spectra.html')]
                    no_edit_candidates = [f for f in html_files if f.lower().endswith('_no_edit_spectra.html')]
                    edited_spectra_html = _newest(edited_candidates)
                    no_edit_spectra_html = _newest(no_edit_candidates)

                    main_candidates = [
                        f for f in html_files
                        if (f not in edited_candidates) and (f not in no_edit_candidates)
                    ]
                    preferred = None
                    # Prefer a report/comparison page; if multiple, choose newest.
                    report_like = [f for f in main_candidates if ('comparison' in f.lower() or 'report' in f.lower())]
                    preferred = _newest(report_like) or _newest(main_candidates)
                    if preferred is not None:
                        report_main_html = f"glioma_mrs_preprocessing/results/report/{preferred}"

                response_data = {
                    'status': 'success',
                    'output': result_stdout,
                    'logs': result_stdout + result_stderr,
                    'pdfs': pdf_files or ["No PDF output found"],
                    'lcmodel_files': lcmodel_files,
                    'report': report_main_html,
                    'report_files': report_files,
                    'edited_spectra_html': edited_spectra_html,
                    'no_edit_spectra_html': no_edit_spectra_html,
                }

                # Convenience URLs for the UI (served by /report/<filename> route).
                try:
                    if preferred is not None:
                        response_data['report_url'] = f"/report/{preferred}"
                    if edited_spectra_html:
                        response_data['edited_spectra_url'] = f"/report/{edited_spectra_html}"
                    if no_edit_spectra_html:
                        response_data['no_edit_spectra_url'] = f"/report/{no_edit_spectra_html}"
                    response_data['report_files_urls'] = [f"/report/{name}" for name in (report_files or [])]
                except Exception:
                    pass

                if not pdf_files and report_main_html:
                    response_data['message'] = "Processing completed (report generated but no PDFs found)"

                _job_finish(job_id, result=response_data)
            except Exception as e:
                _job_emit(job_id, f"\n!!! Pipeline failed: {str(e)}")
                _job_emit(job_id, traceback.format_exc())
                _job_finish(job_id, error_message=str(e))
            finally:
                # Cleanup temp upload folder
                try:
                    if request_temp_dir and os.path.exists(request_temp_dir):
                        shutil.rmtree(request_temp_dir, ignore_errors=True)
                except Exception:
                    pass

        threading.Thread(target=_run_job, daemon=True).start()

        # Respond immediately; client will stream logs via SSE.
        return jsonify({
            'status': 'started',
            'job_id': job_id,
            'events_url': f"/processing-events/{job_id}",
        }), 202

    except Exception as e:
        print(f"\n!!! Pipeline failed: {str(e)}")
        print(traceback.format_exc())

        _job_emit(job_id, f"\n!!! Request failed before starting job: {str(e)}")
        _job_emit(job_id, traceback.format_exc())
        _job_finish(job_id, error_message=str(e))
        
        # Cleanup even if error occurs
        try:
            if 'request_temp_dir' in locals() and os.path.exists(request_temp_dir):
                shutil.rmtree(request_temp_dir, ignore_errors=True)
        except Exception:
            pass
            
        return jsonify({
            'status': 'error',
            'message': str(e)
        }), 500

    finally:
        # Do not cleanup request_temp_dir here: the background thread uses it.
        # Cleanup happens inside the job's finally block.
        pass

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
        args = ['python3', 'mrs_idh_1p19q_classifier/IDH_Classifier.py', user_folder]

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
    lcmodel_root = os.path.join(os.path.dirname(__file__), 'glioma_mrs_preprocessing/fitting/LCModel/output')
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
                    if 'Final Prediction' in headers:
                        pred_idx = headers.index('Final Prediction')
                    else:
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
            ['python3', 'mrs_idh_1p19q_classifier/1p_19q_Classifier.py', full_user_folder],
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

@app.route('/pdfs/<path:filename>')
def serve_pdf(filename):
    # This will serve files from fitting/LCModel/output/ and its subfolders
    pdf_root = os.path.join(os.path.dirname(__file__), 'glioma_mrs_preprocessing/fitting/LCModel/output')
    return send_from_directory(pdf_root, filename)

@app.route('/report/<path:filename>')
def serve_report(filename):
    # This will serve files from fitting/LCModel/output/ and its subfolders
    report_root = os.path.join(os.path.dirname(__file__), 'glioma_mrs_preprocessing/results/report')
    return send_from_directory(report_root, filename)

@app.route('/download-mega/<category>')
def download_mega_category(category):
    category_map = {
        'edited': 'mega_diff',
        'non-edited': 'mega_off',
        'mega_diff': 'mega_diff',
        'mega_off': 'mega_off'
    }
    mapped = category_map.get(str(category).lower())
    if not mapped:
        return abort(404, description="Category folder not found")

    base_dir = os.path.join("glioma_mrs_preprocessing", "fitting", "LCModel", "output", mapped)

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

