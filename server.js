require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3001;

// Get base directory from environment or use default
const baseDir = process.env.PHOTO_BASE_DIR || path.join(__dirname, 'photos');

// Define paths to photo directories
// Now the base directory itself can contain photos to be sorted
const sortedDirs = {
    1: path.join(baseDir, 'sorted', '1'),
    2: path.join(baseDir, 'sorted', '2'),
    3: path.join(baseDir, 'sorted', '3'),
    4: path.join(baseDir, 'sorted', '4'),
    5: path.join(baseDir, 'sorted', '5')
};

console.log('Using photo directories:', {
    base: baseDir,
    sorted: sortedDirs
});

// Cache for storing available photos
const photoCache = {
    base: [],
    sorted: {}
};

// Function to refresh the photo cache
function refreshPhotoCache() {
    console.log('Refreshing photo cache...');
    const startTime = Date.now();
    
    // Clear the existing cache
    photoCache.base = [];
    photoCache.sorted = {};
    
    // Recursively find all photo files in a directory and its subdirectories
    const findPhotosRecursively = (dir, relativeTo) => {
        let photos = [];
        try {
            const files = fs.readdirSync(dir);
            
            files.forEach(file => {
                const fullPath = path.join(dir, file);
                try {
                    const stat = fs.statSync(fullPath);
                    
                    // Skip the 'sorted' directory when scanning the base directory
                    if (dir === baseDir && file === 'sorted') {
                        return;
                    }
                    
                    if (stat.isDirectory()) {
                        // Recursively search subdirectories
                        photos = photos.concat(findPhotosRecursively(fullPath, relativeTo));
                    } else if (/\.(jpg|jpeg|png|gif|bmp)$/i.test(file)) {
                        // Add photo files, preserving relative path from the relative directory
                        const relativePath = path.relative(relativeTo, fullPath);
                        photos.push(relativePath);
                    }
                } catch (err) {
                    console.error(`Error accessing ${fullPath}:`, err);
                }
            });
        } catch (err) {
            console.error(`Error reading directory ${dir}:`, err);
        }
        
        return photos;
    };
    
    // Cache base directory photos
    photoCache.base = findPhotosRecursively(baseDir, baseDir);
    
    // Cache sorted directory photos
    Object.keys(sortedDirs).forEach(key => {
        const sortedDir = sortedDirs[key];
        photoCache.sorted[key] = findPhotosRecursively(sortedDir, sortedDir);
    });
    
    const endTime = Date.now();
    console.log(`Photo cache refreshed in ${endTime - startTime}ms`);
    console.log(`Found ${photoCache.base.length} photos in base directory`);
    Object.keys(photoCache.sorted).forEach(key => {
        console.log(`Found ${photoCache.sorted[key].length} photos in sorted/${key}`);
    });
}

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
ensureDirectoryExists(baseDir);
Object.values(sortedDirs).forEach(dir => ensureDirectoryExists(dir));

// Initial cache refresh
refreshPhotoCache();

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

// Function to get a random photo from the cache
function getRandomPhoto(callback) {
    // Helper function to get a random photo from an array
    function getRandomFromArray(array) {
        if (array.length === 0) return null;
        return array[Math.floor(Math.random() * array.length)];
    }
    
    // Helper function to verify a photo exists
    function verifyPhotoExists(photo, directory) {
        let fullPath;
        if (!directory) {
            fullPath = path.join(baseDir, photo);
        } else {
            fullPath = path.join(baseDir, directory, photo);
        }
        return fs.existsSync(fullPath);
    }
    
    try {
        // First try to get photos from the base directory cache
        if (photoCache.base.length > 0) {
            // Try up to 5 random photos from the cache
            for (let i = 0; i < 5; i++) {
                const randomPhoto = getRandomFromArray(photoCache.base);
                if (randomPhoto && verifyPhotoExists(randomPhoto, '')) {
                    return callback(null, randomPhoto, '');
                } else if (randomPhoto) {
                    // Remove invalid photo from cache
                    const index = photoCache.base.indexOf(randomPhoto);
                    if (index !== -1) {
                        photoCache.base.splice(index, 1);
                    }
                }
            }
        }
        
        // If no valid photos in base directory, check sorted directories
        const sortedDirKeys = Object.keys(photoCache.sorted);
        for (const key of sortedDirKeys) {
            if (photoCache.sorted[key].length > 0) {
                // Try up to 5 random photos from this sorted directory
                for (let i = 0; i < 5; i++) {
                    const randomPhoto = getRandomFromArray(photoCache.sorted[key]);
                    if (randomPhoto && verifyPhotoExists(randomPhoto, `sorted/${key}`)) {
                        return callback(null, randomPhoto, `sorted/${key}`);
                    } else if (randomPhoto) {
                        // Remove invalid photo from cache
                        const index = photoCache.sorted[key].indexOf(randomPhoto);
                        if (index !== -1) {
                            photoCache.sorted[key].splice(index, 1);
                        }
                    }
                }
            }
        }
        
        // If we've tried several photos and none exist, refresh the cache
        refreshPhotoCache();
        
        // Try one more time after refreshing
        if (photoCache.base.length > 0) {
            const randomPhoto = getRandomFromArray(photoCache.base);
            if (randomPhoto && verifyPhotoExists(randomPhoto, '')) {
                return callback(null, randomPhoto, '');
            }
        }
        
        for (const key of sortedDirKeys) {
            if (photoCache.sorted[key].length > 0) {
                const randomPhoto = getRandomFromArray(photoCache.sorted[key]);
                if (randomPhoto && verifyPhotoExists(randomPhoto, `sorted/${key}`)) {
                    return callback(null, randomPhoto, `sorted/${key}`);
                }
            }
        }
        
        // If we get here, no photos were found anywhere
        return callback(new Error('No photos found in any directory'));
    } catch (err) {
        callback(err);
    }
}

app.get('/random-photo', (req, res) => {
    getRandomPhoto((err, photo, directory) => {
        if (err) {
            console.error('Error getting random photo:', err);
            return res.status(500).send('Error getting random photo');
        }
        
        // Directory is already relative to baseDir
        // If directory is empty, it means the photo is in the base directory
        
        res.json({ photo, directory });
    });
});

app.post('/like', (req, res) => {
    const { photo, directory } = req.body;
    if (!photo) {
        return res.status(400).send('Missing photo');
    }
    
    // Determine the source directory
    let sourceDir;
    if (!directory || directory === '') {
        sourceDir = baseDir;
    } else if (directory.includes('sorted')) {
        sourceDir = path.join(baseDir, directory);
    } else {
        return res.status(400).send('Invalid directory');
    }
    
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
        
        // Update the cache after moving the photo
        if (!directory || directory === '') {
            // Remove from base cache
            const index = photoCache.base.indexOf(photo);
            if (index !== -1) {
                photoCache.base.splice(index, 1);
            }
            // Add to sorted/4 cache
            if (!photoCache.sorted['4']) {
                photoCache.sorted['4'] = [];
            }
            photoCache.sorted['4'].push(photo);
        } else if (directory.includes('sorted')) {
            // Extract current rank from the directory path
            const currentRank = parseInt(directory.split('/').pop());
            if (!isNaN(currentRank)) {
                // Remove from current sorted cache
                if (photoCache.sorted[currentRank]) {
                    const index = photoCache.sorted[currentRank].indexOf(photo);
                    if (index !== -1) {
                        photoCache.sorted[currentRank].splice(index, 1);
                    }
                }
                // Add to new sorted cache
                const newRank = Math.min(currentRank + 1, 5);
                if (!photoCache.sorted[newRank]) {
                    photoCache.sorted[newRank] = [];
                }
                photoCache.sorted[newRank].push(photo);
            }
        }
        
        res.send('Photo liked');
    });
});

app.post('/dislike', (req, res) => {
    const { photo, directory } = req.body;
    if (!photo) {
        return res.status(400).send('Missing photo');
    }
    
    // Determine the source directory
    let sourceDir;
    if (!directory || directory === '') {
        sourceDir = baseDir;
    } else if (directory.includes('sorted')) {
        sourceDir = path.join(baseDir, directory);
    } else {
        return res.status(400).send('Invalid directory');
    }
    
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
    const oldPath = path.join(sourceDir, photo);
    if (!fs.existsSync(oldPath)) {
        return res.status(404).send('Photo not found');
    }
    
    // Create new path, preserving subdirectory structure
    const newPath = path.join(targetDir, photo);
    
    // Ensure target directory exists (including any subdirectories)
    ensureDirectoryExists(path.dirname(newPath));
    
    console.log('Moving photo:', {
        oldPath,
        newPath
    });

    fs.rename(oldPath, newPath, (err) => {
        if (err) {
            console.error('Error moving photo:', err);
            return res.status(500).send('Error moving photo');
        }
        
        // Update the cache after moving the photo
        if (!directory || directory === '') {
            // Remove from base cache
            const index = photoCache.base.indexOf(photo);
            if (index !== -1) {
                photoCache.base.splice(index, 1);
            }
            // Add to sorted/2 cache
            if (!photoCache.sorted['2']) {
                photoCache.sorted['2'] = [];
            }
            photoCache.sorted['2'].push(photo);
        } else if (directory.includes('sorted')) {
            // Extract current rank from the directory path
            const currentRank = parseInt(directory.split('/').pop());
            if (!isNaN(currentRank)) {
                // Remove from current sorted cache
                if (photoCache.sorted[currentRank]) {
                    const index = photoCache.sorted[currentRank].indexOf(photo);
                    if (index !== -1) {
                        photoCache.sorted[currentRank].splice(index, 1);
                    }
                }
                // Add to new sorted cache
                const newRank = Math.max(currentRank - 1, 1);
                if (!photoCache.sorted[newRank]) {
                    photoCache.sorted[newRank] = [];
                }
                photoCache.sorted[newRank].push(photo);
            }
        }
        
        res.send('Photo disliked');
    });
});

// Add an endpoint to refresh the cache manually
app.get('/refresh-cache', (req, res) => {
    refreshPhotoCache();
    res.json({
        success: true,
        basePhotos: photoCache.base.length,
        sortedPhotos: Object.keys(photoCache.sorted).reduce((total, key) => total + photoCache.sorted[key].length, 0)
    });
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
