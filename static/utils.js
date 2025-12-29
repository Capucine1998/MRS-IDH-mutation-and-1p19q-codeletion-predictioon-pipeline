// utils.js
function sanitizePath(path) {
    const basePath = "/home/mouette/website/www/html/";
    return path.replace(basePath, '');
}