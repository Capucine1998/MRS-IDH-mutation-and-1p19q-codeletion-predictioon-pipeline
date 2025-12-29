# IDH MRS Classifier

## Project Overview
The IDH MRS Classifier is a comprehensive tool designed for the analysis and classification of Magnetic Resonance Spectroscopy (MRS) data. It integrates preprocessing, quantification, and machine learning-based classification to assist in the diagnosis and research of IDH mutations in gliomas. The project features a web-based interface for user interaction and visualization, as well as backend scripts for data processing and model predictions.

## Features
- **MRS Data Preprocessing**: Includes tools for importing, concatenating, and correcting raw MRS data.
- **LCModel Integration**: Supports external LCModel software for MRS quantification.
- **Machine Learning Classifiers**: Utilizes logistic regression, random forest, and XGBoost models for IDH mutation classification.
- **Web Interface**: Provides an interactive web-based platform for data upload, processing, and visualization.
- **Visualization**: Generates plots for spectra, metabolite concentrations, and SHAP explanations.

## Workflow
1. **Data Import**: Upload DICOM files containing MRS data.
2. **Preprocessing**: Perform water scaling, eddy current, frequency and phase correction and other preprocessing steps.
3. **Quantification**: Use LCModel to quantify metabolite concentrations.
4. **Classification**: Predict IDH mutation status using pre-trained machine learning models on a multicentric cohort.
5. **Visualization**: View spectra, metabolite concentrations, and model explanations.

## File and Folder Structure
- **app.py**: Flask backend for the web interface.
- **preprocessing/**: Contains scripts for MRS data preprocessing.
  - **MRS_process.py**: Main preprocessing script.
  - **utils/**: Utility scripts for data handling and processing.
  - **visualization/**: Scripts for generating plots and visualizations.
- **IDH_classifier/**: Machine learning models and utilities.
  - **Classifier.py**: Main classification script.
  - **models/**: Pre-trained model files.
- **static/**: Frontend assets (HTML, CSS, JavaScript).
- **uploads/**: Directory for user-uploaded files.
- **temp_uploads/**: Temporary storage for uploaded DICOM files.

## Setup and Installation
### Prerequisites
- Python 3.8 or higher
- LCModel software (for MRS quantification)
- Node.js (optional, for frontend development)

### Installation Steps
1. Clone the repository:
   ```bash
   git clone <repository-url>
   cd idh-mrs-classifier
   ```
2. Install Python dependencies:
   ```bash
   pip install -r requirements.txt
   ```
3. Set up LCModel:
   - Ensure LCModel is installed and accessible from the command line.
   - Update paths in preprocessing scripts if necessary.
4. Start the Flask server:
   ```bash
   python app.py
   ```
5. Access the web interface at `http://localhost:5000`.

## Usage
### Web Interface
1. Navigate to the web interface.
2. Upload DICOM files for MRS data.
3. Follow the steps for preprocessing, quantification, and classification.
4. View results and download reports.

### Command-Line Tools
- **Preprocessing**:
  ```bash
  python preprocessing/MRS_process.py <input-folder>
  ```
- **Classification**:
  ```bash
  python IDH_classifier/Classifier.py <input-data>
  ```

## Dependencies
- Python Libraries:
  - numpy, pandas, scipy, matplotlib, plotly, dash, flask
  - scikit-learn, joblib, openpyxl
- LCModel software
- JavaScript Libraries:
  - Plotly.js (for interactive plots)

## Contribution Guidelines
1. Fork the repository and create a new branch for your feature or bug fix.
2. Ensure code adheres to PEP 8 standards.
3. Submit a pull request with a detailed description of changes.

## License
This project is licensed under the MIT License. See the LICENSE file for details.

## Credits
- **Developers**: [Capucine Cadin (Paris Brain Institute), Valentin Cadin (Web development support)]
- **Scientific Contributors / Co-authors:**

Capucine Cadin¹, Gerd Melkus², François-Xavier Lejeune¹, Dinesh Deelchand³, Stéphane Lehéricy¹, Malgorzata Marjańska³, Thanh Binh Nguyen², Francesca Branzoli¹

¹ Paris Brain Institute (ICM), Inserm U 1127, CNRS UMR 7225, Sorbonne University, Paris, France.

² The Ottawa Hospital, 1053 Carling Avenue, Ottawa, Ontario, Canada K1Y 4E9.

³ Center for Magnetic Resonance Research, Department of Radiology, University of Minnesota, Minneapolis, MN, USA.

These collaborators contributed to the design, analysis, or interpretation of the scientific results underlying this tool.

- **Acknowledgments**:
We thank the ASST Spedali Civili University Hospital, the Ottawa Hospital, the Pitié-Salpêtrière Hospital, and the Treviso General Hospital for providing access to datasets.
We acknowledge the Center for Magnetic Resonance Research for their contributions to sequence development.
Special thanks to the developers of LCModel and the open-source libraries used in this project.
This project was supported by the Agence Nationale de la Recherche [ANR-20-CE17-0002-01], under the Investissements d’Avenir [ANR-10-IAIHU-06 et ANR-11-INBS-0006] program.

## Troubleshooting
- **LCModel Errors**: Ensure LCModel paths are correctly set in the scripts.
- **Python Dependency Issues**: Verify that all required libraries are installed.
- **Web Interface Not Loading**: Check that the Flask server is running and accessible.

## FAQ
1. **What is the purpose of this tool?**
   - To assist in the analysis and classification of MRS data for IDH mutation research.
2. **Can I use this tool without LCModel?**
   - No, LCModel is required for MRS quantification.
3. **How do I add new machine learning models?**
   - Add the model file to `IDH_classifier/models/` and update `Classifier.py` to include the new model.
