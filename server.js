const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = 3000;

// Define paths to photo directories
const unsortedDir = path.join(__dirname, 'photos', 'unsorted');
const sortedDirs = {
    1: path.join(__dirname, 'photos', 'sorted', '1'),
    2: path.join(__dirname, 'photos', 'sorted', '2'),
    3: path.join(__dirname, 'photos', 'sorted', '3'),
    4: path.join(__dirname, 'photos', 'sorted', '4'),
    5: path.join(__dirname, 'photos', 'sorted', '5')
};

app.use(express.json());
app.use(express.static('.'));

// Ensure directories exist
function ensureDirectoryExists(dir) {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
}

// Create necessary directories
ensureDirectoryExists(unsortedDir);
Object.values(sortedDirs).forEach(dir => ensureDirectoryExists(dir));

// Function to get a random file from a directory
function getRandomFile(directory, callback) {
    fs.readdir(directory, (err, files) => {
        if (err) return callback(err);
        if (files.length === 0) return callback(new Error('No files found'));
        
        const randomFile = files[Math.floor(Math.random() * files.length)];
        callback(null, randomFile);
    });
}

// Function to get a random photo from either unsorted or sorted directories
function getRandomPhoto(callback) {
    // First check if there are any unsorted photos
    fs.readdir(unsortedDir, (err, unsortedFiles) => {
        if (err) return callback(err);
        
        // Get all sorted photos
        const sortedDirPaths = Object.values(sortedDirs);
        let allSortedFiles = [];
        let processedDirs = 0;
        
        // If there are no unsorted files, check sorted directories
        if (unsortedFiles.length === 0) {
            sortedDirPaths.forEach(dirPath => {
                fs.readdir(dirPath, (err, files) => {
                    processedDirs++;
                    
                    if (!err && files.length > 0) {
                        allSortedFiles = allSortedFiles.concat(
                            files.map(file => ({ file, dir: dirPath }))
                        );
                    }
                    
                    // When all directories have been processed
                    if (processedDirs === sortedDirPaths.length) {
                        if (allSortedFiles.length === 0) {
                            return callback(new Error('No photos found'));
                        }
                        
                        // Select a random sorted file
                        const randomItem = allSortedFiles[Math.floor(Math.random() * allSortedFiles.length)];
                        callback(null, randomItem.file, path.relative(__dirname, randomItem.dir));
                    }
                });
            });
        } else {
            // If there are unsorted files, 80% chance to pick from unsorted
            if (Math.random() < 0.8 || allSortedFiles.length === 0) {
                const randomFile = unsortedFiles[Math.floor(Math.random() * unsortedFiles.length)];
                callback(null, randomFile, 'photos/unsorted');
            } else {
                // 20% chance to pick from sorted
                sortedDirPaths.forEach(dirPath => {
                    fs.readdir(dirPath, (err, files) => {
                        processedDirs++;
                        
                        if (!err && files.length > 0) {
                            allSortedFiles = allSortedFiles.concat(
                                files.map(file => ({ file, dir: dirPath }))
                            );
                        }
                        
                        // When all directories have been processed
                        if (processedDirs === sortedDirPaths.length) {
                            if (allSortedFiles.length === 0) {
                                // If no sorted files, pick from unsorted
                                const randomFile = unsortedFiles[Math.floor(Math.random() * unsortedFiles.length)];
                                callback(null, randomFile, 'photos/unsorted');
                            } else {
                                // Select a random sorted file
                                const randomItem = allSortedFiles[Math.floor(Math.random() * allSortedFiles.length)];
                                callback(null, randomItem.file, path.relative(__dirname, randomItem.dir));
                            }
                        }
                    });
                });
            }
        }
    });
}

app.get('/random-photo', (req, res) => {
    getRandomPhoto((err, photo, directory) => {
        if (err) return res.status(500).send('No photos available');
        res.json({ photo, directory });
    });
});

app.post('/like', (req, res) => {
    const { photo, directory } = req.body;
    if (!photo || !directory) {
        return res.status(400).send('Missing photo or directory');
    }
    
    // Determine the source directory
    const sourceDir = path.join(__dirname, directory);
    
    // Determine the target directory (like = 4)
    let targetDir = sortedDirs[4];
    
    // If the photo is already in a sorted directory, we need to handle its rank
    if (directory.includes('sorted')) {
        // Extract current rank from the directory path
        const currentRank = parseInt(directory.split('/').pop());
        if (!isNaN(currentRank)) {
            // Increase rank by 1, but cap at 5
            const newRank = Math.min(currentRank + 1, 5);
            // Update target directory based on new rank
            targetDir = sortedDirs[newRank];
        }
    }
    
    // Verify source file exists
    if (!fs.existsSync(sourceDir)) {
        return res.status(404).send('Source directory not found');
    }
    
    const oldPath = path.join(sourceDir, photo);
    if (!fs.existsSync(oldPath)) {
        return res.status(404).send('Photo not found');
    }
    
    const newPath = path.join(targetDir, photo);
    
    // Ensure target directory exists
    ensureDirectoryExists(path.dirname(newPath));
    
    fs.rename(oldPath, newPath, (err) => {
        if (err) {
            console.error('Error moving photo:', err);
            return res.status(500).send('Error moving photo');
        }
        res.send('Photo liked');
    });
});

app.post('/dislike', (req, res) => {
    const { photo, directory } = req.body;
    if (!photo || !directory) {
        return res.status(400).send('Missing photo or directory');
    }
    
    // Determine the source directory
    const sourceDir = path.join(__dirname, directory);
    
    // Determine the target directory (dislike = 2)
    let targetDir = sortedDirs[2];
    
    // If the photo is already in a sorted directory, we need to handle its rank
    if (directory.includes('sorted')) {
        // Extract current rank from the directory path
        const currentRank = parseInt(directory.split('/').pop());
        if (!isNaN(currentRank)) {
            // Decrease rank by 1, but floor at 1
            const newRank = Math.max(currentRank - 1, 1);
            // Update target directory based on new rank
            targetDir = sortedDirs[newRank];
        }
    }
    
    // Verify source file exists
    if (!fs.existsSync(sourceDir)) {
        return res.status(404).send('Source directory not found');
    }
    
    const oldPath = path.join(sourceDir, photo);
    if (!fs.existsSync(oldPath)) {
        return res.status(404).send('Photo not found');
    }
    
    const newPath = path.join(targetDir, photo);
    
    // Ensure target directory exists
    ensureDirectoryExists(path.dirname(newPath));
    
    fs.rename(oldPath, newPath, (err) => {
        if (err) {
            console.error('Error moving photo:', err);
            return res.status(500).send('Error moving photo');
        }
        res.send('Photo disliked');
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
