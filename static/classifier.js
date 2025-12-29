// Main function to handle form submission and run the classifier
let autoFormData = null;


async function runPythonScript(event) {
    event.preventDefault();
    const resultBox = document.getElementById('result');
    resultBox.style.display = 'block';

    // Auto-loaded path: from preprocessing pipeline
    if (window.preloadedFormData) {
        resultBox.innerText = 'Processing (auto-imported files)...';
        resultBox.style.color = 'black';

        try {
            const response = await fetch('/run-classifier', {
                method: 'POST',
                body: window.preloadedFormData
            });

            const result = await response.json();
            const userFolder = result.user_folder?.replace(/^users\//, '') || '';

            if (!response.ok) {
                handleErrorResponse(result, resultBox);
            } else {
                await handleSuccessfulResponse(
                    userFolder,
                    window.preloadedFormData.has('coordFilesDiff') && window.preloadedFormData.has('printFilesDiff'),
                    resultBox
                );
            }
        } catch (error) {
            resultBox.innerText = 'Request failed: ' + sanitizePath(error.message);
            resultBox.style.color = 'red';
        }

        window.preloadedFormData = null;
        return;
    }

    // Manual upload path
    const fileInputCoordOff = document.getElementById('fileInputCoordOff');
    const fileInputPrintOff = document.getElementById('fileInputPrintOff');
    const fileInputCoordDiff = document.getElementById('fileInputCoordDiff');
    const fileInputPrintDiff = document.getElementById('fileInputPrintDiff');

    const formData = new FormData();
    const validExts = { coord: ".COORD", print: ".PRINT" };

    const validateAndAppend = (files, expectedExt, fieldName) => {
        for (const file of files) {
            if (!file.name.endsWith(expectedExt)) {
                resultBox.innerText = `Error: Files for ${fieldName} must end with ${expectedExt}`;
                resultBox.style.color = 'red';
                throw new Error('Invalid extension');
            }
            formData.append(fieldName, file);
        }
    };

    // Validate MEGA_OFF files
    if (!fileInputCoordOff.files.length || !fileInputPrintOff.files.length) {
        resultBox.innerText = 'Error: At least MEGA_OFF .COORD and .PRINT files must be selected';
        resultBox.style.color = 'red';
        return;
    }

    try {
        validateAndAppend(fileInputCoordOff.files, validExts.coord, 'coordFilesOff');
        validateAndAppend(fileInputPrintOff.files, validExts.print, 'printFilesOff');

        if (fileInputCoordDiff.files.length && fileInputPrintDiff.files.length) {
            validateAndAppend(fileInputCoordDiff.files, validExts.coord, 'coordFilesDiff');
            validateAndAppend(fileInputPrintDiff.files, validExts.print, 'printFilesDiff');
        }
    } catch (error) {
        return; // handled above
    }

    try {
        //resultBox.innerText = 'Processing...';
        resultBox.style.color = 'black';

        const response = await fetch('/run-classifier', {
            method: 'POST',
            body: formData
        });

        const result = await response.json();
        const userFolder = result.user_folder?.replace(/^users\//, '') || '';

        if (!response.ok) {
            handleErrorResponse(result, resultBox);
        } else {
            await handleSuccessfulResponse(
                userFolder,
                fileInputCoordDiff.files.length > 0 && fileInputPrintDiff.files.length > 0,
                resultBox
            );
        }

    } catch (error) {
        resultBox.innerText = 'Request failed: ' + sanitizePath(error.message);
        resultBox.style.color = 'red';
    }
}


// Handle successful response from server
async function handleSuccessfulResponse(userFolder, usedMegaDiff, resultBox) {
    try {
        // Determine which prediction files to fetch
        const predictions = {
            idh: usedMegaDiff ? 
                'predictions_mega_off_and_diff.csv' : 
                'predictions_mega_off.csv',
            p19q: usedMegaDiff ?
                'predictions_1p_19q_codeletion_mega_off_and_diff.csv' :
                'predictions_1p_19q_codeletion_mega_off.csv'
        };

        // Display IDH predictions
        await displayPredictionFile(userFolder, predictions.idh);
        
        // Try to display 1p/19q predictions (may not exist if no IDH mutants)
        try {
            await displayPredictionFile(userFolder, predictions.p19q);
        } catch (err) {
            console.warn('1p/19q Prediction CSV missing:', err);
        }

        // Show SD plots
        await displaySdPlots(userFolder);

        // Show SD plots
        await displayAnalysisPlots(userFolder);

        // Show SHAP plots
        await displayShapPlots(userFolder, usedMegaDiff);

        // Update UI
        // resultBox.innerText = 'Prediction complete!';
        resultBox.style.color = 'green';
        history.replaceState(null, '', `/static/classifier.html?user_folder=${userFolder}`);

    } catch (error) {
        resultBox.innerText = 'Error displaying results: ' + error.message;
        resultBox.style.color = 'red';
    }
}

// Display a prediction CSV file
async function displayPredictionFile(userFolder, filename) {
  try {
    // Ensure the userFolder does not already include 'diagnostics'
    const cleanUserFolder = userFolder.replace(/\/diagnostics\/?$/, '');
      const url = filename.includes('diagnostics/')
      ? `/users/${filename}`
      : `/users/${cleanUserFolder}/diagnostics/${filename}`;

    console.log('Fetching from:', url); // Log the URL to verify it

    const response = await fetch(url);

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const csvText = await response.text();
    displayPredictions(csvText, filename, userFolder);

  } catch (error) {
    console.error('Error:', error);
    alert(`Failed to load predictions: ${error.message}`);
  }
}




// Display SD plots
async function displaySdPlots(userFolder) {
  try {
    const response = await fetch(`/list-sd-plots/${userFolder}`);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    const urls = await response.json();
    console.log('SD Plot URLs:', urls); // Debugging line

    const container = document.getElementById('sd-container');
    container.style.display = 'block';
    container.innerHTML = '<h2>Standard Deviation (SD) Metabolites</h2>';

    urls.forEach((url, i) => {
      const plotDiv = document.createElement('div');
      plotDiv.className = 'plot-box';
      plotDiv.innerHTML = `
        <iframe src="${url}" class="plot-frame" loading="lazy"></iframe>
        <button id="download-sd-button-${i}">Download HTML</button>
      `;
      container.appendChild(plotDiv);

      document.getElementById(`download-sd-button-${i}`).onclick = async () => {
        try {
          const fileResponse = await fetch(url);
          if (!fileResponse.ok) {
            throw new Error(`HTTP error! status: ${fileResponse.status}`);
          }
          const fileContent = await fileResponse.text();
          console.log('File content:', fileContent); // Debugging line
          downloadFile(url.split('/').pop(), fileContent, 'text/html');
        } catch (error) {
          console.error('Error fetching file content:', error);
        }
      };
    });
  } catch (error) {
    console.error('Error displaying SD plots:', error);
  }
}

// Display Metabolite Analysis plots
async function displayAnalysisPlots(userFolder) {
  try {
    const response = await fetch(`/analysis-plots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_folder: userFolder })
    });

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();
    console.log('Analysis Plot Response:', data); // Debugging line

    if (!data.plots) {
      throw new Error('No plots found in the response');
    }

    const container = document.getElementById('analysis-container');
    container.style.display = 'block';
    container.innerHTML = '<h2>Metabolite Analysis Board</h2>';

    // Object.entries(data.plots).forEach(([key, url], i) => {
    //   const plotDiv = document.createElement('div');
    //   plotDiv.className = 'plot-box';
    //   plotDiv.innerHTML = `
    //     <iframe src="${url}" class="plot-frame" loading="lazy"></iframe>
    //     <button id="download-analysis-button-${i}">Download HTML</button>
    //   `;
    //   container.appendChild(plotDiv);

    //   document.getElementById(`download-analysis-button-${i}`).onclick = async () => {
    //     try {
    //       const fileResponse = await fetch(url);
    //       if (!fileResponse.ok) {
    //         throw new Error(`HTTP error! status: ${fileResponse.status}`);
    //       }
    //       const fileContent = await fileResponse.text();
    //       console.log('File content:', fileContent); // Debugging line
    //       downloadFile(url.split('/').pop(), fileContent, 'text/html');
    //     } catch (error) {
    //       console.error('Error fetching file content:', error);
    //     }
    //   };
    // });

    Object.entries(data.plots).forEach(([key, urls], i) => {
        // Make sure to handle both strings and arrays of URLs
        const urlList = Array.isArray(urls) ? urls : [urls];

        urlList.forEach((url, j) => {
            const plotDiv = document.createElement('div');
            plotDiv.className = 'plot-box';
            plotDiv.innerHTML = `
            <iframe src="${url}" class="plot-frame" loading="lazy"></iframe>
            <button id="download-analysis-button-${i}-${j}">Download HTML</button>
            `;
            container.appendChild(plotDiv);

            document.getElementById(`download-analysis-button-${i}-${j}`).onclick = async () => {
            try {
                const fileResponse = await fetch(url);
                if (!fileResponse.ok) throw new Error(`HTTP error! status: ${fileResponse.status}`);
                const fileContent = await fileResponse.text();
                downloadFile(url.split('/').pop(), fileContent, 'text/html');
            } catch (error) {
                console.error('Error fetching file content:', error);
            }
            };
        });
    });

  } catch (error) {
    console.error('Error displaying Analysis plots:', error);
  }
}

// Display SHAP plots
async function displayShapPlots(userFolder, usedMegaDiff) {
  const modelPrefix = usedMegaDiff ? 'mega_off_and_diff' : 'mega_off';

  // IDH SHAP plots
  tryDisplayShapPlot('shap-explanation-idh', 'shap_IDH_bar-image', 'download-shap_IDH_bar-button', [
    `/users/${userFolder}/models_${modelPrefix}/idh_xgb_shap_${modelPrefix}_bar.png`,
    `/users/${userFolder}/models_idh_mutation_mega_off/idh_xgb_shap_mega_off_bar.png`
  ]);

  tryDisplayShapPlot('shap-explanation-idh', 'shap_IDH_beeswarm-image', 'download-shap_IDH_beeswarm-button', [
    `/users/${userFolder}/models_${modelPrefix}/idh_xgb_shap_${modelPrefix}_beeswarm.png`,
    `/users/${userFolder}/models_idh_mutation_mega_off/idh_xgb_shap_mega_off_beeswarm.png`
  ]);

  // 1p/19q SHAP plots
  tryDisplayShapPlot('shap-explanation-1p19q', 'shap_1p19q_bar-image', 'download-shap_1p19q_bar-button', [
    `/users/${userFolder}/models_1p_19q_codeletion_${modelPrefix}/1p19q_xgb_shap_${modelPrefix}_bar.png`,
    `/users/${userFolder}/models_1p_19q_codeletion_mega_off/1p19q_xgb_shap_mega_off_bar.png`
  ]);

  tryDisplayShapPlot('shap-explanation-1p19q', 'shap_1p19q_beeswarm-image', 'download-shap_1p19q_beeswarm-button', [
    `/users/${userFolder}/models_1p_19q_codeletion_${modelPrefix}/1p19q_xgb_shap_${modelPrefix}_beeswarm.png`,
    `/users/${userFolder}/models_1p_19q_codeletion_mega_off/1p19q_xgb_shap_mega_off_beeswarm.png`
  ]);
}


// Handle error response from server
function handleErrorResponse(result, resultBox) {
    resultBox.innerText = 'Error: ' + sanitizePath(result.error);
    resultBox.style.color = 'red';

    const errorMatch = result.error.match(/'(.+?)'/);
    if (errorMatch) {
        const metabo = errorMatch[1].replace('metabo not found: ', '');
        const suggestion = document.createElement('p');
        suggestion.innerText = `Suggestion: Check if the metabolite "${metabo}" is present in the input files`;
        suggestion.style.color = 'gray';
        resultBox.appendChild(suggestion);
    }

    cleanupUserFolder(result.user_folder);
    document.getElementById('predictions-section-idh').style.display = 'none';
    document.getElementById('predictions-section-1p19q').style.display = 'none';
}

// Display predictions in a table
function displayPredictions(csvText, filename, userFolder) {
    console.log('Displaying predictions for:', filename); 
    const is1p19q = filename.includes('1p_19q');
    const sectionId = is1p19q ? 'predictions-section-1p19q' : 'predictions-section-idh';
    const tableId = is1p19q ? 'predictions-table-1p19q' : 'predictions-table-idh';
    
    const section = document.getElementById(sectionId);
    const table = document.getElementById(tableId);
    
    // Parse CSV
    const rows = csvText.split('\n').filter(row => row.trim() !== '');
    const headers = rows[0].split(',');
    
    // Debug output
    console.log('CSV Headers:', headers);
    console.log('First row:', rows[1]);

    // Create table header
    const thead = table.querySelector('thead');
    thead.innerHTML = '';
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
        const th = document.createElement('th');
        th.textContent = header;
        if (header === 'Final_Prediction') {
            th.style.backgroundColor = '#F1461F';
        }
        headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);

    // Create table body
    const tbody = table.querySelector('tbody');
    tbody.innerHTML = '';
    rows.slice(1).forEach(row => {
        const tr = document.createElement('tr');
        const cells = row.split(',');
        cells.forEach((cell, index) => {
            const td = document.createElement('td');
            td.textContent = cell;
            if (headers[index] === 'Final_Prediction') {
                td.classList.add('final-prediction');
            }
            tr.appendChild(td);
        });
        tbody.appendChild(tr);
    });
    
    // Add download buttons
    addDownloadButtons(section, csvText, filename);
    
    // Show the section
    section.style.display = 'block';
    
    // Check IDH status for second classifier
    if (!is1p19q) {
        const idhStatusIndex = headers.indexOf('Final_Prediction');
        
        if (idhStatusIndex === -1) {
            console.error('Final_Prediction column not found');
            return;
        }

        // More flexible mutant detection
        const isIDHMutant = rows.slice(1).some(row => {
            const cols = row.split(',');
            const prediction = cols[idhStatusIndex]?.trim().toLowerCase();
            return prediction.includes('mutant') || prediction.includes('positive');
        });

        console.log(`IDH mutant cases found: ${isIDHMutant}`);
        
        if (isIDHMutant) {
            console.log('Launching 1p/19q classifier...');
            runSecondClassifier(userFolder);
        }
    }
}

// Add download buttons to a section
function addDownloadButtons(section, content, filename) {
    let downloadDiv = section.querySelector('.download-buttons');
    if (downloadDiv) return;  // Buttons already exist
    
    downloadDiv = document.createElement('div');
    downloadDiv.className = 'download-buttons';
    
    const csvButton = document.createElement('button');
    csvButton.textContent = 'Download CSV';
    csvButton.onclick = () => downloadFile(filename, content, 'text/csv');
    
    const xlsxButton = document.createElement('button');
    xlsxButton.textContent = 'Download XLSX';
    xlsxButton.onclick = () => downloadFile(
        filename.replace('.csv', '.xlsx'), 
        content, 
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    
    downloadDiv.appendChild(csvButton);
    downloadDiv.appendChild(xlsxButton);
    section.appendChild(downloadDiv);
}

// Helper functions
function sanitizePath(path) {
    // Implement your path sanitization logic here
    return path;
}

function downloadFile(filename, content, mimeType) {
  console.log(`Downloading file: ${filename}, MIME type: ${mimeType}`); // Debugging line

  // Create a Blob with the correct MIME type
  const blob = new Blob([content], { type: mimeType });

  // Create a URL for the Blob
  const url = URL.createObjectURL(blob);

  // Create an anchor element to trigger the download
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;

  // Append the anchor to the body and trigger the click event
  document.body.appendChild(a);
  a.click();

  // Clean up by removing the anchor and revoking the Blob URL
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  console.log(`File downloaded: ${filename}`); // Debugging line
}

// Example of using SheetJS library for CSV to Excel conversion
async function convertCsvToExcelAndDownload(csvText, filename) {
  // Load the SheetJS library
  const XLSX = await import('https://cdn.sheetjs.com/xlsx-0.19.3/package/dist/xlsx.full.min.js');

  // Convert CSV to workbook
  const workbook = XLSX.read(csvText, { type: 'string' });

  // Generate Excel file
  const excelBuffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });

  // Create a Blob with the Excel file
  const blob = new Blob([excelBuffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });

  // Create a URL for the Blob
  const url = URL.createObjectURL(blob);

  // Create an anchor element to trigger the download
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.replace('.csv', '.xlsx');

  // Append the anchor to the body and trigger the click event
  document.body.appendChild(a);
  a.click();

  // Clean up by removing the anchor and revoking the Blob URL
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// Modify the addDownloadButtons function to use the conversion function
function addDownloadButtons(section, content, filename) {
  let downloadDiv = section.querySelector('.download-buttons');
  if (downloadDiv) return;  // Buttons already exist
  downloadDiv = document.createElement('div');
  downloadDiv.className = 'download-buttons';
  const csvButton = document.createElement('button');
  csvButton.textContent = 'Download CSV';
  csvButton.onclick = () => downloadFile(filename, content, 'text/csv');
  const xlsxButton = document.createElement('button');
  xlsxButton.textContent = 'Download XLSX';
  xlsxButton.onclick = () => convertCsvToExcelAndDownload(content, filename);
  downloadDiv.appendChild(csvButton);
  downloadDiv.appendChild(xlsxButton);
  section.appendChild(downloadDiv);
}



// Initialize the page

document.addEventListener('DOMContentLoaded', async () => {
    showSection('classifier');

    const params = new URLSearchParams(window.location.search);
    const userFolder = params.get("user_folder");
    const lcmodelParam = params.get("lcmodel_files");

    if (userFolder && lcmodelParam) {
        try {
            const lcmodelFiles = JSON.parse(decodeURIComponent(lcmodelParam));
            const coordOff = lcmodelFiles.filter(f => f.includes("mega_off") && f.endsWith(".COORD"));
            const printOff = lcmodelFiles.filter(f => f.includes("mega_off") && f.endsWith(".PRINT"));
            const coordDiff = lcmodelFiles.filter(f => f.includes("mega_diff") && f.endsWith(".COORD"));
            const printDiff = lcmodelFiles.filter(f => f.includes("mega_diff") && f.endsWith(".PRINT"));

            const urlToFile = async (path) => {
                const filename = path.split('/').pop();
                const url = `/users/${userFolder}/${path}`;
                const response = await fetch(url);
                const blob = await response.blob();
                return new File([blob], filename, { type: 'text/plain' });
            };

            autoFormData = new FormData();
            for (const f of coordOff) autoFormData.append("coordFilesOff", await urlToFile(f));
            for (const f of printOff) autoFormData.append("printFilesOff", await urlToFile(f));
            for (const f of coordDiff) autoFormData.append("coordFilesDiff", await urlToFile(f));
            for (const f of printDiff) autoFormData.append("printFilesDiff", await urlToFile(f));

            autoFormData.append("user_folder", userFolder);

            // Now trigger classifier
            document.getElementById('auto-trigger-classifier')?.click();

        } catch (e) {
            console.error("Error preparing auto form data:", e);
        }
    }
});





// Load results from previous session
async function loadPreviousResults(userFolder) {
    const filesToTry = [
        'predictions_mega_off_and_diff.csv',
        'predictions_mega_off.csv',
        'predictions_1p_19q_codeletion_mega_off_and_diff.csv',
        'predictions_1p_19q_codeletion_mega_off.csv'
    ];
    
    for (const filename of filesToTry) {
        try {
            await displayPredictionFile(userFolder, filename);
        } catch (e) {
            console.warn(`Failed to load ${filename}:`, e);
        }
    }
}

// Show a specific section
function showSection(sectionId) {
    document.querySelectorAll('.section').forEach(section => {
        section.style.display = 'none';
    });
    document.getElementById(sectionId).style.display = 'block';
}

// Try to display a SHAP plot
async function tryDisplayShapPlot(containerId, imgId, btnId, paths) {
  const container = document.getElementById(containerId);
  const img = document.getElementById(imgId);
  const btn = document.getElementById(btnId);

  if (!container || !img || !btn) {
    console.error(`Missing elements for SHAP plot: ${containerId}, ${imgId}, ${btnId}`);
    return;
  }

  // Try GET requests (more reliable than HEAD) and log status
  for (const plotUrl of paths) {
    console.log('Trying SHAP URL:', plotUrl);
    try {
      const response = await fetch(plotUrl, { method: 'GET' });
      console.log(' ->', plotUrl, 'status:', response.status, 'content-type:', response.headers.get('content-type'));
      if (response.ok) {
        const blob = await response.blob();
        const objectUrl = URL.createObjectURL(blob);
        img.src = objectUrl;
        img.style.display = 'block';
        btn.style.display = 'inline-block';
        btn.onclick = () => window.open(plotUrl, '_blank');
        container.style.display = 'block';
        return;
      }
    } catch (e) {
      console.warn(`Failed to fetch plot from ${plotUrl}:`, e);
    }
  }

  // If none of the paths worked
  img.style.display = 'none';
  btn.style.display = 'none';
  container.innerHTML = '<p style="color: red;">SHAP plots unavailable for this analysis.</p>';
}



// Run second classifier for IDH mutant cases
async function runSecondClassifier(userFolder) {
    const fullUserFolder = userFolder.replace(/^users\//, '');
    const resultBox = document.getElementById('result');

    try {
        // Show loading state
        const loadingElement = document.createElement('div');
        loadingElement.className = 'loading-status';
        loadingElement.innerHTML = `
            <div class="spinner"></div>
            <span>Running 1p/19q classifier analysis...</span>
        `;
        resultBox.appendChild(loadingElement);

        // Run the classifier
        const response = await fetch('/run-second-classifier', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                user_folder: fullUserFolder,  // Use the adjusted path
                timestamp: new Date().toISOString()
            })
        });

        // Process response
        const result = await processApiResponse(response);

        if (!result.predictions_csv) {
            throw new Error('Server did not return prediction results');
        }

        // Display success
        showSuccessMessage(resultBox, '1p/19q analysis completed successfully!');
        // await displaySecondPrediction(result.predictions_csv);
        await displayPredictionFile(userFolder, result.predictions_csv);

    } catch (error) {
        // Handle different error types
        const errorMessage = getErrorMessage(error);
        showErrorMessage(resultBox, `1p/19q analysis failed: ${errorMessage}`);

        console.error('Second classifier error:', {
            error: error,
            userFolder: userFolder,
            timestamp: new Date().toISOString()
        });
    } finally {
        // Clean up loading state
        const loadingElement = resultBox.querySelector('.loading-status');
        if (loadingElement) {
            loadingElement.remove();
        }
    }
}



// Helper function to process API responses
async function processApiResponse(response) {
    const contentType = response.headers.get('content-type');
    let data;

    if (contentType && contentType.includes('application/json')) {
        data = await response.json();
    } else {
        data = await response.text();
    }

    if (!response.ok) {
        let errorMsg = 'Request failed';
        
        if (data && data.error) {
            errorMsg = data.error;
        } else if (typeof data === 'string' && data) {
            errorMsg = data;
        } else {
            errorMsg = `HTTP ${response.status} - ${response.statusText}`;
        }
        
        throw new Error(errorMsg);
    }

    return data;
}

// Error message formatting
function getErrorMessage(error) {
    if (error instanceof TypeError && error.message.includes('Failed to fetch')) {
        return 'Network connection failed. Please check your internet connection.';
    }
    
    if (error.message.includes('Server did not return')) {
        return 'The analysis completed but no results were returned.';
    }
    
    if (error.message.toLowerCase().includes('unknown error')) {
        return 'An unexpected error occurred during processing.';
    }
    
    return error.message || 'An unknown error occurred';
}

// UI feedback functions
function showSuccessMessage(container, message) {
    const successElement = document.createElement('div');
    successElement.className = 'success-message';
    successElement.textContent = message;
    container.appendChild(successElement);
}

function showErrorMessage(container, message) {
    const errorElement = document.createElement('div');
    errorElement.className = 'error-message';
    errorElement.innerHTML = `
        <strong>Error:</strong> ${message}
        <div class="error-suggestion">Please try again or contact support if the problem persists.</div>
    `;
    container.appendChild(errorElement);
}

async function displaySecondPrediction(csvPath) {
  try {
    console.log('Fetching CSV from:', csvPath); // Debugging line
    const response = await fetch(csvPath);
    if (!response.ok) {
      throw new Error('Failed to fetch prediction results');
    }

    const csvText = await response.text();
    console.log('CSV Data:', csvText); // Debugging line

    // Rest of the function to process and display the CSV data
    const container = document.createElement('div');
    container.className = 'second-classifier-results';

    // Create a table to display the CSV data
    const table = document.createElement('table');
    table.className = 'predictions-table';

    // Parse CSV and create table rows
    const rows = csvText.split('\n').filter(row => row.trim() !== '');
    const headers = rows[0].split(',');

    // Create header
    const thead = document.createElement('thead');
    const headerRow = document.createElement('tr');
    headers.forEach(header => {
      const th = document.createElement('th');
      th.textContent = header;
      headerRow.appendChild(th);
    });
    thead.appendChild(headerRow);
    table.appendChild(thead);

    // Create body
    const tbody = document.createElement('tbody');
    rows.slice(1).forEach(row => {
      const tr = document.createElement('tr');
      row.split(',').forEach(cell => {
        const td = document.createElement('td');
        td.textContent = cell;
        tr.appendChild(td);
      });
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);

    container.innerHTML = '<h3>1p/19q Codeletion Predictions</h3>';
    container.appendChild(table);

    // Add download button
    const downloadBtn = document.createElement('button');
    downloadBtn.textContent = 'Download Results';
    downloadBtn.onclick = () => {
      const blob = new Blob([csvText], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = '1p19q_predictions.csv';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    };
    container.appendChild(downloadBtn);

    // Add to DOM
    const existingResults = document.querySelector('.second-classifier-results');
    if (existingResults) {
      existingResults.replaceWith(container);
    } else {
      document.getElementById('classifier').appendChild(container);
    }

  } catch (error) {
    console.error('Error displaying second prediction:', error);
  }
}





// Clean up user folder
function cleanupUserFolder(userFolder) {
    fetch('/cleanup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_folder: userFolder })
    }).catch(error => console.error('Error cleaning up user folder:', error));
}

window.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const lcmodelFilesRaw = urlParams.get('lcmodel_files');
    let lcmodelFiles = [];
    if (lcmodelFilesRaw) {
        try {
            lcmodelFiles = JSON.parse(decodeURIComponent(lcmodelFilesRaw));
        } catch (e) {
            console.error("Could not parse lcmodel_files:", e);
        }
    }
    console.log("LCModel files received:", lcmodelFiles);

    // Example: automatically populate file selection UI
    const fileListContainer = document.getElementById('lcmodel-file-list');
    if (fileListContainer && lcmodelFiles.length > 0) {
        fileListContainer.innerHTML = '';
        lcmodelFiles.forEach(file => {
            const li = document.createElement('li');
            li.textContent = file;
            fileListContainer.appendChild(li);
        });
    }
});