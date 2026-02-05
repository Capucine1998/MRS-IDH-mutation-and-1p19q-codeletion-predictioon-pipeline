import logging
import os
import sys

def setup_logging(debug=False, log_dir=None, name="mrs"):
    log_level = logging.DEBUG if debug else logging.INFO
    fmt = "%(asctime)s %(levelname)s [%(name)s] %(module)s.%(funcName)s: %(message)s"
    datefmt = "%H:%M:%S"

    logger = logging.getLogger(name)
    logger.setLevel(log_level)

    # Clear any existing handlers to avoid duplication
    logger.handlers = []

    # Console handler
    ch = logging.StreamHandler(sys.stdout)
    ch.setLevel(log_level)
    ch.setFormatter(logging.Formatter(fmt, datefmt))
    logger.addHandler(ch)

    # File handler
    if log_dir is None:
        log_dir = os.path.join(os.path.dirname(__file__), "..", "results", "logs")
    os.makedirs(log_dir, exist_ok=True)
    
    fh = logging.FileHandler(os.path.join(log_dir, "pipeline.log"), mode="a", encoding="utf-8")
    fh.setLevel(log_level)
    fh.setFormatter(logging.Formatter(fmt, datefmt))
    logger.addHandler(fh)

    logger.debug("Logger initialized (debug=%s, log_dir=%s)", debug, os.path.abspath(log_dir))
    return logger