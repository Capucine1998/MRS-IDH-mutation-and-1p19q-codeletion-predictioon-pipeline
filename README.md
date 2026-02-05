# IDH MRS Classifier

## Overview
A web-based platform for preprocessing, quantification, and machine learning-based classification of Magnetic Resonance Spectroscopy (MRS) data, focused on IDH mutation and 1p/19q codeletion status in gliomas. The tool integrates data upload, automated pipelines, and interactive visualization.

## Features
- Upload and preprocess raw MRS data (DICOM, IMA, etc.)
- Automated quantification using LCModel
- Machine learning classifiers for IDH mutation and 1p/19q codeletion (logistic regression, random forest, XGBoost)
- Interactive web interface for workflow and visualization
- Downloadable results and reports
- SHAP-based model explanation plots

## Directory Structure
- `app.py`: Flask backend for the web interface
- `glioma_mrs_preprocessing/`: Preprocessing scripts and utilities
- `mrs_idh_1p19q_classifier/`: Machine learning models and scripts
   - `IDH_Classifier.py`: Main IDH classification script
   - `1p_19q_Classifier.py`: Main 1p/19q codeletion script
   - `models/`: Pre-trained model files
- `static/`: Frontend assets (HTML, CSS, JS)
- `temp_uploads/`, `users/`: User and temporary data storage

## Installation

### Prerequisites
- Python 3.8+
- LCModel (external, for quantification)
- Node.js (optional, for frontend development)

### Steps
```bash
git clone <repository-url>
cd idh-mrs-classifier
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```
- Install and configure LCModel, ensuring it is accessible from your PATH.
- Update any LCModel paths in scripts if needed.

### Running the App
```bash
python app.py
```
Visit [http://localhost:5000](http://localhost:5000) in your browser.

## Usage

### Web Interface
1. Upload MRS data files.
2. Follow the guided steps for preprocessing, quantification, and classification.
3. View and download results and plots.

### Command Line
- Preprocessing:
   ```bash
   python glioma_mrs_preprocessing/MRS_process.py <input-folder>
   ```
- Classification:
   ```bash
   python mrs_idh_1p19q_classifier/IDH_Classifier.py <user-folder> <coord_off> <print_off> <coord_diff> <print_diff>
   python mrs_idh_1p19q_classifier/1p_19q_Classifier.py <user-folder>
   ```

## Dependencies

- Python: numpy, pandas, scipy, matplotlib, plotly, flask, scikit-learn, joblib, openpyxl, etc.
- LCModel (external)
- JavaScript: Plotly.js

## Contributing

1. Fork and branch from main.
2. Follow PEP8 and best practices.
3. Submit a pull request with a clear description.

## License

MIT License. See LICENSE file.

## Credits & Acknowledgments

- Developers: Capucine Cadin, Valentin Cadin
- Scientific contributors: Capucine Cadin¹, Thanh Binh Nguyen2, Lucia Nichelli3, Gerd Melkus2, Roberto Liserre4, Matteo Bendini5, François Xavier Lejeune6, Dinesh Deelchand7, Franck Bielle1,3, Mehdi Touat1,3, Bertrand Mathon1,3, Marc Sanson¹,3, Stephane Lehéricy3,8, Małgorzata Marjańska7, Francesca Branzoli¹

  ¹ Paris Brain Institute - ICM, Inserm U 1127, CNRS UMR 7225, Sorbonne Université, UMR S 1127, Paris, France. Équipe BRIGHT, labelisée LNCC
  ² Department of Radiology, Radiation Oncology and Medical Physics, University of Ottawa
  ³ Sorbonne Université, La Pitié Salpêtrière University Hospital - Charles Foix, Paris, France
  4 Department of Radiology, Neuroradiology Unit, ASST Spedali Civili University Hospital, Brescia, Italy
  5 Neuroradiology Unit, Local Health Authority n.2 Marca Trevigiana, Treviso, Italy
  6 Data Analysis Core, Paris Brain Institute, Paris, France
  7 Center for Magnetic Resonance Research, Department of Radiology, University of Minnesota, Minneapolis, MN, USA
  8 Paris Brain Institute - ICM, Center for NeuroImaging Research – CENIR, MOVIT team, Inserm U 1127, CNRS UMR 7225, Sorbonne Université, UMR S 1127, Paris, France


These collaborators contributed to the design, analysis, or interpretation of the scientific results underlying this tool.

Acknowledgments:
We thank the ASST Spedali Civili University Hospital, the Ottawa Hospital, the Pitié-Salpêtrière Hospital, and the Treviso General Hospital for providing access to datasets.
We acknowledge the Center for Magnetic Resonance Research for their contributions to sequence development.
Special thanks to the developers of LCModel and the open-source libraries used in this project.
This project was supported by the Agence Nationale de la Recherche [ANR-20-CE17-0002-01], under the Investissements d’Avenir [ANR-10-IAIHU-06 et ANR-11-INBS-0006] program.

## Troubleshooting

- LCModel errors: Check LCModel installation and script paths.
- Python errors: Ensure all dependencies are installed.
- Web issues: Confirm Flask server is running.

