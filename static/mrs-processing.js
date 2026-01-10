let selectedDatatype = 'MEGA-PRESS'; // Default datatype for now (no UI selection)

// Manual multi-folder selections (because most browsers don't allow selecting multiple directories
// in a single <input webkitdirectory> picker, even with the `multiple` attribute).
let multiFolderFiles = []; // for MULTI PATIENT mode -> sent as `directoryFiles`
let monoFidFiles = [];     // for MONO mode -> sent as `dcmFiles`
let monoWaterFiles = [];   // for MONO mode -> sent as `waterDcmFiles`

let _manualFolderPickCounter = 0;

// Source-of-truth selections grouped by folder label.
let multiFolderBatches = new Map();
let monoFidBatches = new Map();
let monoWaterBatches = new Map();

function flattenBatches(batches) {
    const out = [];
    for (const items of (batches || new Map()).values()) {
        for (const it of (items || [])) out.push(it);
    }
    return out;
}

function rebuildFlatSelections() {
    multiFolderFiles = flattenBatches(multiFolderBatches);
    monoFidFiles = flattenBatches(monoFidBatches);
    monoWaterFiles = flattenBatches(monoWaterBatches);
}

function resetSelectedUploadsUI() {
    // Browsers may restore <input type="file"> values via BFCache or session restore.
    // Force a clean state on load/refresh.
    multiFolderFiles = [];
    monoFidFiles = [];
    monoWaterFiles = [];

    multiFolderBatches = new Map();
    monoFidBatches = new Map();
    monoWaterBatches = new Map();

    const idsToClear = [
        'directory',
        'dcmFile',
        'waterDcmFile',
        'T1Input',
        'T2FLAIRInput',
        'DiffusionMRIInput',
        'APTInput'
    ];

    for (const id of idsToClear) {
        const input = document.getElementById(id);
        if (input && input.type === 'file') {
            input.value = '';
        }
    }

    const statusIds = ['multiFolderStatus', 'fidFolderStatus', 'waterFolderStatus'];
    for (const id of statusIds) {
        const el = document.getElementById(id);
        if (el) el.textContent = '';
    }

    validateForm();
}

function isDcmFileName(name) {
    return typeof name === 'string' && name.toLowerCase().endsWith('.dcm');
}

function selectionGroupKeyFromRelPath(relPath) {
    // relPath examples:
    //  - "S14/file.dcm" => group "S14"
    //  - "parent/S14/file.dcm" (picked parent folder) => group "parent/S14"
    //  - "S14/subdir/file.dcm" => group "S14/subdir" (best effort)
    if (typeof relPath !== 'string' || relPath.length === 0) return '(unknown)';
    const parts = relPath.split('/').filter(Boolean);
    if (parts.length === 0) return '(unknown)';
    if (parts.length === 1) return parts[0];

    // If second part is actually a file name, don't include it in the group.
    if (isDcmFileName(parts[1])) return parts[0];
    return `${parts[0]}/${parts[1]}`;
}

function renderSelectedFoldersSummary(selectedItems) {
    const counts = new Map();
    for (const it of (selectedItems || [])) {
        const key = selectionGroupKeyFromRelPath(it.relPath || '');
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    const folders = Array.from(counts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    const total = selectedItems ? selectedItems.length : 0;
    return { folders, total };
}

function updateSelectionStatus(targetArray, statusEl) {
    if (!statusEl) return;
    statusEl.style.whiteSpace = 'pre-line';

    const { folders, total } = renderSelectedFoldersSummary(targetArray);
    if (total === 0) {
        statusEl.textContent = '';
        return;
    }

    const lines = folders.map(([name, n]) => `${name}: ${n} .dcm`);
    statusEl.textContent = `${lines.join('\n')}\nTotal: ${total} .dcm`;
}

function updateSelectionStatusFromBatches(batches, statusEl) {
    if (!statusEl) return;
    statusEl.style.whiteSpace = 'pre-line';

    const entries = Array.from((batches || new Map()).entries())
        .map(([label, items]) => [label, (items || []).length])
        .filter(([, n]) => n > 0)
        .sort((a, b) => a[0].localeCompare(b[0]));

    const total = entries.reduce((acc, [, n]) => acc + n, 0);
    if (total === 0) {
        statusEl.textContent = '';
        return;
    }

    const lines = entries.map(([label, n]) => `${label}: ${n} .dcm`);
    statusEl.textContent = `${lines.join('\n')}\nTotal: ${total} .dcm`;
}

function mergeFilesIntoBatches(fileList, batches) {
    const files = Array.from(fileList || []).filter(f => isDcmFileName(f.name));
    const grouped = new Map();

    for (const f of files) {
        const relPath = f.webkitRelativePath || f.name;
        const group = selectionGroupKeyFromRelPath(relPath);
        if (!grouped.has(group)) grouped.set(group, []);
        grouped.get(group).push({ relPath, file: f });
    }

    for (const [group, items] of grouped.entries()) {
        let label = group;
        if (!batches.has(label)) {
            label = makeUniqueFolderLabel(label, new Set(batches.keys()));
        }
        batches.set(label, items);
    }

    rebuildFlatSelections();
}

function makeUniqueFolderLabel(desired, existingLabels) {
    const base = (desired && desired.trim().length > 0) ? desired.trim() : `folder_${Date.now()}_${++_manualFolderPickCounter}`;
    if (!existingLabels.has(base)) return base;
    let i = 2;
    while (existingLabels.has(`${base}_${i}`)) i += 1;
    return `${base}_${i}`;
}

async function collectFilesFromDirectoryHandle(dirHandle, baseName) {
    // Recursively collect .dcm files with a synthetic relative path.
    // Returns: [{ file: File, relPath: string }]
    const collected = [];
    async function walk(handle, relPrefix) {
        for await (const entry of handle.values()) {
            if (entry.kind === 'file') {
                const file = await entry.getFile();
                if (isDcmFileName(file.name)) {
                    collected.push({
                        file,
                        relPath: `${relPrefix}${file.name}`
                    });
                }
            } else if (entry.kind === 'directory') {
                await walk(entry, `${relPrefix}${entry.name}/`);
            }
        }
    }

    await walk(dirHandle, `${baseName}/`);
    return collected;
}

async function addFolderInto(targetBatches, statusEl) {
    // Uses File System Access API when available. If unavailable, caller should fall back.
    if (!window.showDirectoryPicker) {
        throw new Error('showDirectoryPicker not available');
    }
    const dirHandle = await window.showDirectoryPicker();
    const existingLabels = new Set(Array.from((targetBatches || new Map()).keys()));
    let dirLabel = (dirHandle.name && dirHandle.name.trim().length > 0) ? dirHandle.name.trim() : '';
    if (!dirLabel) {
        dirLabel = `folder_${Date.now()}_${++_manualFolderPickCounter}`;
    }
    if (existingLabels.has(dirLabel)) {
        dirLabel = makeUniqueFolderLabel(dirLabel, existingLabels);
    }
    const items = await collectFilesFromDirectoryHandle(dirHandle, dirLabel);

    // Accumulate this folder as a new batch.
    targetBatches.set(dirLabel, items);

    rebuildFlatSelections();
    updateSelectionStatusFromBatches(targetBatches, statusEl);
    validateForm();
}

document.addEventListener("DOMContentLoaded", function () {
    const multiBtn = document.getElementById("multiBtn");
    const monoBtn = document.getElementById("monoBtn");
    const runBtn = document.getElementById("runBtn");

    const form = document.getElementById("uploadForm");
    const multiForm = document.getElementById("multiForm");
    const monoForm = document.getElementById("monoForm");

    const radioGroups = document.querySelectorAll(".radio-btn");
    const checkboxGroups = document.querySelectorAll(".checkbox-btn");
    const directoryInput = document.getElementById("directory");
    const dcmFileInput = document.getElementById("dcmFile");
    const waterDcmFileInput = document.getElementById("waterDcmFile");

    const addMultiFolderBtn = document.getElementById("addMultiFolderBtn");
    const addFidFolderBtn = document.getElementById("addFidFolderBtn");
    const addWaterFolderBtn = document.getElementById("addWaterFolderBtn");

    const multiFolderStatus = document.getElementById("multiFolderStatus");
    const fidFolderStatus = document.getElementById("fidFolderStatus");
    const waterFolderStatus = document.getElementById("waterFolderStatus");

    // Optional section: may be absent if UI hides these options.
    const anatomicalInputs = {
        "T1": document.getElementById("T1Input"),
        "T2-FLAIR": document.getElementById("T2FLAIRInput"),
        "DIFFUSION MRI": document.getElementById("DiffusionMRIInput"),
        "APT": document.getElementById("APTInput")
    };

    

    runBtn.addEventListener("click", runPipeline);

    // Add a small hint under the run button to explain why it may be disabled.
    (function ensureRunHint() {
        if (document.getElementById('runHint')) return;
        const hint = document.createElement('div');
        hint.id = 'runHint';
        hint.style.marginTop = '8px';
        hint.style.fontSize = '14px';
        hint.style.color = '#444';
        hint.style.whiteSpace = 'pre-line';
        // Insert right after the Run button
        runBtn.insertAdjacentElement('afterend', hint);
    })();

    // Clear any restored file inputs on first load.
    resetSelectedUploadsUI();

    multiBtn.addEventListener("click", function () {
        toggleForms(multiBtn, monoBtn, multiForm, monoForm);
    });

    monoBtn.addEventListener("click", function () {
        toggleForms(monoBtn, multiBtn, monoForm, multiForm);
    });

    radioGroups.forEach((button) => {
        button.addEventListener("click", function () {
            handleRadioButtonClick(button);

            // Dynamically set the selected datatype
            if (button.getAttribute("data-group") === "mrs-data") {
                selectedDatatype = button.getAttribute("data-datatype");
                console.log("Selected datatype:", selectedDatatype);
            }
        });
    });

    checkboxGroups.forEach((button) => {
        button.addEventListener("click", function () {
            handleCheckboxButtonClick(button, anatomicalInputs);
        });
    });

    dcmFileInput.addEventListener("change", function () {
        handleFileInputChange(dcmFileInput, '.dcm');
        console.log("DCM files selected:", dcmFileInput.files);
        if (dcmFileInput.files && dcmFileInput.files.length > 0) {
            mergeFilesIntoBatches(dcmFileInput.files, monoFidBatches);
            updateSelectionStatusFromBatches(monoFidBatches, fidFolderStatus);
        }
        validateForm();
    });


    waterDcmFileInput.addEventListener("change", function () {
        handleFileInputChange(waterDcmFileInput, '.dcm');
        if (waterDcmFileInput.files && waterDcmFileInput.files.length > 0) {
            mergeFilesIntoBatches(waterDcmFileInput.files, monoWaterBatches);
            updateSelectionStatusFromBatches(monoWaterBatches, waterFolderStatus);
        }
        validateForm();
    });

    Object.values(anatomicalInputs).forEach(input => {
        if (!input) return;
        input.addEventListener("change", function () {
            handleAnatomicalInputChange(input);
        });
    });

    directoryInput.addEventListener("input", function () {
        // Directory upload fallback: use webkitRelativePath to keep per-folder grouping
        if (directoryInput.files && directoryInput.files.length > 0) {
            mergeFilesIntoBatches(directoryInput.files, multiFolderBatches);
            updateSelectionStatusFromBatches(multiFolderBatches, multiFolderStatus);
        }
        validateForm();
    });
    directoryInput.addEventListener("change", function () {
        if (directoryInput.files && directoryInput.files.length > 0) {
            mergeFilesIntoBatches(directoryInput.files, multiFolderBatches);
            updateSelectionStatusFromBatches(multiFolderBatches, multiFolderStatus);
        }
        validateForm();
    });

    // Manual multi-folder picker buttons (Chromium / secure context)
    if (addMultiFolderBtn) {
        addMultiFolderBtn.addEventListener('click', async () => {
            try {
                await addFolderInto(multiFolderBatches, multiFolderStatus);
            } catch (e) {
                // Fallback: open the classic picker
                directoryInput.click();
            }
        });
    }
    if (addFidFolderBtn) {
        addFidFolderBtn.addEventListener('click', async () => {
            try {
                await addFolderInto(monoFidBatches, fidFolderStatus);
            } catch (e) {
                dcmFileInput.click();
            }
        });
    }
    if (addWaterFolderBtn) {
        addWaterFolderBtn.addEventListener('click', async () => {
            try {
                await addFolderInto(monoWaterBatches, waterFolderStatus);
            } catch (e) {
                waterDcmFileInput.click();
            }
        });
    }

});

// Also clear inputs when the page is restored from BFCache (back/forward navigation)
// or when the browser rehydrates the page state.
window.addEventListener('pageshow', function () {
    try {
        resetSelectedUploadsUI();
    } catch (e) {
        // no-op
    }
});


function createPdfControls(pdfPath) {
    const container = document.createElement('div');
    container.style.width = "100%";

    const viewerWrapper = document.createElement('div');
    viewerWrapper.style.overflow = "auto";
    viewerWrapper.style.width = "100%";
    viewerWrapper.style.border = "1px solid #ccc";
    viewerWrapper.style.borderRadius = "6px";
    viewerWrapper.style.textAlign = "center";

    const embed = document.createElement('embed');
    embed.src = `/pdfs/${pdfPath}`;
    embed.type = "application/pdf";
    embed.style.width = "100%";
    embed.style.height = "1000px";
    embed.style.transformOrigin = "top center";
    embed.style.transition = "transform 0.2s ease";

    let scale = 1;

    const zoomInBtn = document.createElement('button');
    zoomInBtn.innerText = "+ Zoom";
    const zoomOutBtn = document.createElement('button');
    zoomOutBtn.innerText = "− Zoom";
    const downloadBtn = document.createElement('a');
    downloadBtn.href = `/pdfs/${pdfPath}`;
    downloadBtn.download = pdfPath.split('/').pop();
    downloadBtn.innerText = "Download PDF";
    downloadBtn.style.textDecoration = "none";

    [zoomInBtn, zoomOutBtn, downloadBtn].forEach(el => {
        el.style.margin = "10px";
        el.style.padding = "8px 16px";
        el.style.borderRadius = "5px";
        el.style.border = "none";
        el.style.cursor = "pointer";
        el.style.backgroundColor = "#223D70";
        el.style.color = "#fff";
        el.style.fontSize = "14px";
        el.style.textDecoration = "none";
    });

    zoomInBtn.onclick = () => {
        scale = Math.min(scale + 0.1, 2.0);
        embed.style.transform = `scale(${scale})`;
    };

    zoomOutBtn.onclick = () => {
        scale = Math.max(scale - 0.1, 0.5);
        embed.style.transform = `scale(${scale})`;
    };

    const controlBar = document.createElement('div');
    controlBar.style.textAlign = "center";
    controlBar.appendChild(zoomInBtn);
    controlBar.appendChild(zoomOutBtn);
    controlBar.appendChild(downloadBtn);

    viewerWrapper.appendChild(embed);
    container.appendChild(controlBar);
    container.appendChild(viewerWrapper);

    return container;
}



async function runPipeline(event) {
    event.preventDefault();

    const formData = new FormData();
    const monoBtn = document.getElementById("monoBtn");
    const multiBtn = document.getElementById("multiBtn");
    const dcmFileInput = document.getElementById("dcmFile");
    const waterDcmFileInput = document.getElementById("waterDcmFile");
    const directoryInput = document.getElementById("directory");

    if (monoBtn.classList.contains("active")) {
        const dcmFiles = (monoFidFiles.length > 0)
            ? monoFidFiles
            : Array.from(dcmFileInput.files).filter(f => isDcmFileName(f.name)).map(f => ({ relPath: f.webkitRelativePath || f.name, file: f }));

        const waterDcmFiles = (monoWaterFiles.length > 0)
            ? monoWaterFiles
            : Array.from(waterDcmFileInput.files).filter(f => isDcmFileName(f.name)).map(f => ({ relPath: f.webkitRelativePath || f.name, file: f }));

        // Use relPath as the uploaded filename to preserve folder grouping and avoid collisions.
        dcmFiles.forEach(({ file, relPath }) => formData.append('dcmFiles', file, relPath));
        waterDcmFiles.forEach(({ file, relPath }) => formData.append('waterDcmFiles', file, relPath));
    } else if (multiBtn.classList.contains("active")) {
        const directoryFiles = (multiFolderFiles.length > 0)
            ? multiFolderFiles
            : Array.from(directoryInput.files).filter(f => isDcmFileName(f.name)).map(f => ({ relPath: f.webkitRelativePath || f.name, file: f }));

        directoryFiles.forEach(({ file, relPath }) => formData.append('directoryFiles', file, relPath));
    }

    try {
        formData.append("datatype", selectedDatatype);  

        const response = await fetch("/run-processing", {
            method: "POST",
            body: formData,
        });


        const result = await response.json();
        const userFolder = result.user_folder?.replace(/^users\//, '') || '';


        if (response.ok) {
            console.log("Pipeline output:", result.output);
            alert("Pipeline ran successfully!");

            // Update a div or another element with the results
            document.getElementById('output').innerText = result.output;

            // Display PDFs
            const pdfContainer = document.getElementById('pdf-container');
            pdfContainer.innerHTML = '';
            
            if (!result.pdfs || result.pdfs.length === 0) {
                pdfContainer.innerHTML = "<p>No PDF output found.</p>";
                return;
            }

            const megaDiff = result.pdfs.find(p => p.startsWith("mega_diff/"));
            const megaOff = result.pdfs.find(p => p.startsWith("mega_off/"));

            // 🧠 Handle MEGA DIFF + MEGA OFF side-by-side
            if (megaDiff || megaOff) {
                const megaSection = document.createElement('div');
                megaSection.style.margin = "2em auto";
                megaSection.style.maxWidth = "95%";
                megaSection.style.backgroundColor = "#ffffff";
                megaSection.style.borderRadius = "8px";
                megaSection.style.boxShadow = "0 0 15px rgba(0, 0, 0, 0.1)";
                megaSection.style.padding = "1em";

                const title = document.createElement('h2');
                title.innerText = "MEGA PRESS LCMODEL OUTPUTS";
                title.style.textAlign = "center";
                title.style.color = "#223D70";
                title.style.marginBottom = "1em";
                megaSection.appendChild(title);

                const row = document.createElement('div');
                row.style.display = "flex";
                row.style.gap = "20px";
                row.style.justifyContent = "center";
                row.style.flexWrap = "wrap";

                [megaDiff, megaOff].forEach((pdf, i) => {
                    if (pdf) {
                        const box = document.createElement('div');
                        box.style.flex = "1 1 48%";
                        box.style.minWidth = "400px";

                        const label = document.createElement('h3');
                        label.innerText = pdf.startsWith("mega_diff") ? "MEGA DIFF" : "MEGA OFF";
                        label.style.textAlign = "center";
                        label.style.color = "#264766";
                        label.style.marginBottom = "10px";

                        box.appendChild(label);
                        box.appendChild(createPdfControls(pdf));

                        row.appendChild(box);

                        // Add associated files list + download all
                        const downloadBox = document.createElement('div');
                        downloadBox.style.margin = "10px auto";
                        downloadBox.style.padding = "10px";
                        downloadBox.style.backgroundColor = "#E3E9EF";
                        downloadBox.style.borderRadius = "6px";
                        downloadBox.style.boxShadow = "0 0 8px rgba(0,0,0,0.05)";


                        const downloadAll = document.createElement('a');
                        downloadAll.href = `/download-mega/${pdf.startsWith("mega_diff") ? "mega_diff" : "mega_off"}`;
                        downloadAll.innerText = "Download all related files (.CONTROL/.COORD/.PDF/.PLOTIN/.PRINT/.PS/.RAW)";
                        downloadAll.style.display = "inline-block";
                        downloadAll.style.marginTop = "10px";
                        downloadAll.style.padding = "8px 16px";
                        downloadAll.style.backgroundColor = "#223D70";
                        downloadAll.style.color = "#fff";
                        downloadAll.style.borderRadius = "5px";
                        downloadAll.style.textDecoration = "none";

                        downloadBox.appendChild(downloadAll);
                        box.appendChild(downloadBox);

                    }

 
                });


                megaSection.appendChild(row);
                pdfContainer.appendChild(megaSection);
            }



            //  Handle other PDFs
            result.pdfs.forEach((pdf) => {
                if (pdf.startsWith("mega_diff/") || pdf.startsWith("mega_off/")) return;

                const wrapper = document.createElement('div');
                wrapper.style.margin = "2em auto";
                wrapper.style.maxWidth = "1000px";
                wrapper.style.padding = "1em";
                wrapper.style.backgroundColor = "#ffffff";
                wrapper.style.borderRadius = "8px";
                wrapper.style.boxShadow = "0 0 15px rgba(0, 0, 0, 0.1)";
                wrapper.style.textAlign = "center";

                wrapper.appendChild(createPdfControls(pdf));
                pdfContainer.appendChild(wrapper);
                

            });
            
            if (result.report || (result.report_files && result.report_files.length > 0)) {
                const reportContainer = document.getElementById("report-container");
                const pngFile = result.report_files?.find(f => f.toLowerCase().endsWith('.png'));
                const reportFileName = result.report?.split('/').pop();

                reportContainer.innerHTML = '';

                const wrapper = document.createElement('div');
                Object.assign(wrapper.style, {
                    margin: "2em auto",
                    maxWidth: "1000px",
                    padding: "1em",
                    backgroundColor: "#ffffff",
                    borderRadius: "8px",
                    boxShadow: "0 0 15px rgba(0, 0, 0, 0.1)",
                    textAlign: "center"
                });

                // Embed HTML report if available
                if (result.report && reportFileName) {
                    const iframe = document.createElement("iframe");
                    iframe.src = `/report/${reportFileName}`; 
                    Object.assign(iframe.style, {
                        width: "100%",
                        height: "600px",
                        border: "1px solid #ccc",
                        borderRadius: "8px",
                        marginBottom: "20px"
                    });
                    wrapper.appendChild(iframe);
                }

                // Download links
                const downloadArea = document.createElement('div');
                downloadArea.style.marginTop = "10px";

                if (reportFileName) {
                    const htmlDownloadLink = document.createElement('a');
                    htmlDownloadLink.href = `/report/${reportFileName}`;
                    htmlDownloadLink.download = reportFileName;
                    htmlDownloadLink.innerText = "Download Report (HTML)";
                    Object.assign(htmlDownloadLink.style, {
                        display: "inline-block",
                        marginRight: "10px",
                        padding: "8px 16px",
                        backgroundColor: "#223D70",
                        color: "#fff",
                        borderRadius: "5px",
                        textDecoration: "none"
                    });
                    downloadArea.appendChild(htmlDownloadLink);
                }

                if (pngFile) {
                    const pngDownloadLink = document.createElement('a');
                    pngDownloadLink.href = `/report/${pngFile}`;
                    pngDownloadLink.download = pngFile;
                    pngDownloadLink.innerText = "Download Report (PNG)";
                    Object.assign(pngDownloadLink.style, {
                        display: "inline-block",
                        padding: "8px 16px",
                        backgroundColor: "#223D70",
                        color: "#fff",
                        borderRadius: "5px",
                        textDecoration: "none"
                    });
                    downloadArea.appendChild(pngDownloadLink);
                }

                wrapper.appendChild(downloadArea);

                // List all report files
                if (result.report_files && result.report_files.length > 0) {
                    const fileList = document.createElement('div');
                    fileList.style.marginTop = "20px";

                    result.report_files.forEach(file => {
                        const link = document.createElement('a');
                        link.href = `/report/${file}`;
                        link.innerText = `Download ${file}`;
                        Object.assign(link.style, {
                            display: "block",
                            marginBottom: "6px",
                            textDecoration: "underline",
                            color: "#223D70"
                        });
                        fileList.appendChild(link);
                    });

                    wrapper.appendChild(fileList);
                }

                reportContainer.appendChild(wrapper);
            }




            const promptContainer = document.getElementById('classifier-prompt');
            promptContainer.innerHTML = '';
            
            const proceedBtn = document.createElement('button');
            proceedBtn.innerText = "Proceed to Classifier";
            proceedBtn.className = "run_button";

            // Collect all LCModel files (.COORD, .PRINT, etc.) from MEGA OFF and MEGA DIFF
            const lcmodelFiles = (result.lcmodel_files || []);
            const encodedFiles = encodeURIComponent(JSON.stringify(lcmodelFiles));

            proceedBtn.onclick = () => {
                window.location.href = `/static/classifier.html?user_folder=${userFolder}&lcmodel_files=${encodedFiles}`;
            };

            promptContainer.appendChild(proceedBtn);

        } else {
            console.error("Error running pipeline:", result.message);
            alert("Error running pipeline: " + result.message);
            document.getElementById('logs').innerText = result.logs;
        }

    } catch (error) {
        console.error("Error:", error);
        alert("An error occurred while running the pipeline.");
        document.getElementById('logs').innerText = error.message;
    }

}

function toggleForms(activeBtn, inactiveBtn, activeForm, inactiveForm) {
    activeBtn.classList.add("active");
    inactiveBtn.classList.remove("active");
    activeForm.style.display = "block";
    inactiveForm.style.display = "none";
    validateForm();
}

function handleRadioButtonClick(button) {
    const group = button.getAttribute("data-group");
    document.querySelectorAll(`.radio-btn[data-group="${group}"]`).forEach((btn) => {
        btn.classList.remove("active");
    });
    button.classList.add("active");
    console.log(`Radio button clicked: ${button.innerText}, Group: ${group}`);
    validateForm();
}

function handleCheckboxButtonClick(button, anatomicalInputs) {
    const type = button.getAttribute("data-type");
    const input = anatomicalInputs[type];

    // Optional UI: if anatomical inputs aren't present, ignore.
    if (!input) {
        return;
    }

    if (button.classList.contains("active")) {
        button.classList.remove("active");
        input.value = "";
        validateForm();
    } else {
        button.classList.add("active");
        if (!button.classList.contains("active")) {
            console.log(`Triggering file input for ${type}`);
            input.click();
        }
    }
}

function handleFileInputChange(input, validExtension) {
    const files = Array.from(input.files);
    const validFiles = files.filter(file => file.name.endsWith(validExtension));

    if (validFiles.length > 0) {
        console.log(`Selected ${validExtension} files:`, validFiles);
    } else {
        console.log(`No ${validExtension} files selected.`);
    }

    validateForm();
}

function handleAnatomicalInputChange(input) {
    const files = Array.from(input.files);
    const validFiles = files.filter(file => file.name.endsWith('.dcm') || file.name.endsWith('.nii'));
    const type = input.id.replace("Input", "");
    const button = document.querySelector(`.checkbox-btn[data-type="${type}"]`);

    if (validFiles.length > 0) {
        console.log(`Selected files for ${input.id}:`, validFiles);
        button.classList.add("active");
    } else {
        console.log(`No valid files selected for ${input.id}.`);
        button.classList.remove("active");
    }

    validateForm();
}

function validateForm() {
    const multiBtn = document.getElementById("multiBtn");
    const monoBtn = document.getElementById("monoBtn");
    const runBtn = document.getElementById("runBtn");
    const directoryInput = document.getElementById("directory");
    const dcmFileInput = document.getElementById("dcmFile");
    const radioGroups = document.querySelectorAll(".radio-btn");

    // If the options UI is removed, treat these as satisfied.
    const hasMrsDataOptions = document.querySelectorAll('.radio-btn[data-group="mrs-data"]').length > 0;
    const hasConditionOptions = document.querySelectorAll('.radio-btn[data-group="condition"]').length > 0;

    let isRadioChecked = !hasMrsDataOptions;
    let isConditionChecked = !hasConditionOptions;

    radioGroups.forEach((button) => {
        if (hasMrsDataOptions && button.classList.contains("active") && button.getAttribute("data-group") === "mrs-data") {
            isRadioChecked = true;
        }
        if (hasConditionOptions && button.classList.contains("active") && button.getAttribute("data-group") === "condition") {
            isConditionChecked = true;
        }
    });

    console.log("Radio checked:", isRadioChecked);
    console.log("Condition checked:", isConditionChecked);
    const monoCount = (monoFidFiles.length > 0) ? monoFidFiles.length : dcmFileInput.files.length;
    const multiCount = (multiFolderFiles.length > 0) ? multiFolderFiles.length : directoryInput.files.length;

    console.log("DCM files selected (mono):", monoCount);
    console.log("DCM files selected (multi):", multiCount);

    const runHint = document.getElementById('runHint');
    const hints = [];
    if (hasMrsDataOptions && !isRadioChecked) hints.push('Select an MRS DATA option.');
    if (hasConditionOptions && !isConditionChecked) hints.push('Select a PATIENT CONDITION option.');

    if (multiBtn.classList.contains("active")) {
        if (multiCount <= 0) {
            hints.push('MULTI mode: select at least one folder (use “Add folder” or the folder picker).');
            if (monoCount > 0) {
                hints.push(`You currently have MONO input selected (${monoCount} .dcm). Click “MONO (Files)” to run with those.`);
            }
        }
    } else if (monoBtn.classList.contains("active")) {
        if (monoCount <= 0) {
            hints.push('MONO mode: select at least one .dcm file/folder.');
            if (multiCount > 0) {
                hints.push(`You currently have MULTI input selected (${multiCount} .dcm). Click “MULTI PATIENT (Folder)” to run with those.`);
            }
        }
    }
    if (runHint) {
        runHint.textContent = hints.join('\n');
    }

    if (multiBtn.classList.contains("active")) {
        if (isRadioChecked && isConditionChecked && multiCount > 0) {
            runBtn.disabled = false;
        } else {
            runBtn.disabled = true;
        }
    } else if (monoBtn.classList.contains("active")) {
        if (isRadioChecked && isConditionChecked && monoCount > 0) {
            runBtn.disabled = false;
        } else {
            runBtn.disabled = true;
        }
    }
}