require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

// Get base directory from environment or use default
const baseDir = process.env.PHOTO_BASE_DIR || path.join(__dirname, 'photos');

// Define paths to photo directories
const unsortedDir = path.join(baseDir, 'unsorted');

const sortedDirs = {
    1: path.join(baseDir, 'sorted', '1'),
    2: path.join(baseDir, 'sorted', '2'),
    3: path.join(baseDir, 'sorted', '3'),
    4: path.join(baseDir, 'sorted', '4'),
    5: path.join(baseDir, 'sorted', '5')
};

console.log('Using photo directories:', {
    base: baseDir,
    unsorted: unsortedDir,
    sorted: sortedDirs
});

app.use(express.json());

// Serve photos from the base directory
app.use('/photos', express.static(baseDir));

// Serve other static files
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
        
        // Filter for image files
        const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
        if (imageFiles.length === 0) return callback(new Error('No image files found'));
        
        const randomFile = imageFiles[Math.floor(Math.random() * imageFiles.length)];
        callback(null, randomFile);
    });
}

// Function to get a random photo from either unsorted or sorted directories
function getRandomPhoto(callback) {
    // First check if there are any unsorted photos
    fs.readdir(unsortedDir, (err, unsortedFiles) => {
        if (err) return callback(err);
        
        // Filter for image files
        const unsortedImages = unsortedFiles.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
        
        // If there are unsorted photos, always return one of those
        if (unsortedImages.length > 0) {
            const randomFile = unsortedImages[Math.floor(Math.random() * unsortedImages.length)];
            callback(null, randomFile, 'unsorted');
            return;
        }
        
        // If no unsorted photos, get all sorted photos for re-ranking
        console.log('No unsorted photos, getting sorted photos for re-ranking...');
        const sortedDirPaths = Object.values(sortedDirs).filter(dirPath => !dirPath.includes('/sorted/1'));
        let allSortedFiles = [];
        let processedDirs = 0;
        
        sortedDirPaths.forEach(dirPath => {
            fs.readdir(dirPath, (err, files) => {
                processedDirs++;
                
                if (!err && files.length > 0) {
                    // Filter for image files
                    const imageFiles = files.filter(file => /\.(jpg|jpeg|png|gif)$/i.test(file));
                    allSortedFiles = allSortedFiles.concat(
                        imageFiles.map(file => ({ file, dir: dirPath }))
                    );
                }
                
                // When all directories have been processed
                if (processedDirs === sortedDirPaths.length) {
                    if (allSortedFiles.length === 0) {
                        return callback(new Error('No photos found'));
                    }
                    
                    // Select a random sorted file for re-ranking
                    const randomItem = allSortedFiles[Math.floor(Math.random() * allSortedFiles.length)];
                    callback(null, randomItem.file, path.relative(baseDir, randomItem.dir));
                }
            });
        });
    });
}

app.get('/random-photo', (req, res) => {
    getRandomPhoto((err, photo, directory) => {
        if (err) {
            console.error('Error getting random photo:', err);
            return res.status(500).send('No photos available');
        }
        
        console.log('Random photo found:', {
            photo,
            directory,
            unsortedDir: path.relative(baseDir, unsortedDir),
            baseDir
        });

        // Directory is already relative to baseDir
        const relativePath = directory || 'unsorted';
        
        res.json({ photo, directory: relativePath });
    });
});

app.post('/like', (req, res) => {
    const { photo, directory } = req.body;
    if (!photo || !directory) {
        return res.status(400).send('Missing photo or directory');
    }
    
    // Determine the source directory
    const sourceDir = directory === 'unsorted' ? unsortedDir : path.join(baseDir, directory);
    
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
    console.log('Moving photo:', {
        oldPath,
        newPath
    })
    
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
    const sourceDir = directory === 'unsorted' ? unsortedDir : path.join(baseDir, directory);
    
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
    
    console.log('Moving photo:', {
        oldPath,
        newPath
    })

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
