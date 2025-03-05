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
    
    // Calculate and print folder ranks after cache refresh
    calculateAndPrintFolderRanks();
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

// Function to get folder ranks data
function getFolderRanksData() {
    // Create a map to store folder information
    const folderRanks = new Map();
    
    // Process photos from all sorted directories
    Object.keys(photoCache.sorted).forEach(rank => {
        const rankNum = parseInt(rank);
        
        photoCache.sorted[rank].forEach(photoPath => {
            // Extract the folder path from the photo path
            const folderPath = path.dirname(photoPath);
            if (folderPath === '.') return; // Skip photos directly in the sorted directory
            
            // Create a unique key for the folder (without the rank part)
            const folderKey = folderPath;
            
            // Update or create folder entry
            if (!folderRanks.has(folderKey)) {
                folderRanks.set(folderKey, {
                    totalRank: rankNum,
                    count: 1,
                    photosByRank: { [rankNum]: 1 },
                    unsortedCount: 0 // Initialize unsorted count
                });
            } else {
                const folder = folderRanks.get(folderKey);
                folder.totalRank += rankNum;
                folder.count += 1;
                folder.photosByRank[rankNum] = (folder.photosByRank[rankNum] || 0) + 1;
            }
        });
    });
    
    // Process photos from base directory to count unsorted photos per folder
    photoCache.base.forEach(photoPath => {
        // Extract the folder path from the photo path
        const folderPath = path.dirname(photoPath);
        if (folderPath === '.') return; // Skip photos directly in the base directory
        
        // Create a unique key for the folder
        const folderKey = folderPath;
        
        // Update or create folder entry
        if (!folderRanks.has(folderKey)) {
            folderRanks.set(folderKey, {
                totalRank: 0,
                count: 0,
                photosByRank: {},
                unsortedCount: 1 // This is the first unsorted photo for this folder
            });
        } else {
            const folder = folderRanks.get(folderKey);
            folder.unsortedCount = (folder.unsortedCount || 0) + 1;
        }
    });
    
    // Convert map to array for sorting
    const sortedFolders = Array.from(folderRanks.entries()).map(([folderPath, data]) => {
        return {
            folderPath,
            averageRank: data.count > 0 ? data.totalRank / data.count : 0,
            photoCount: data.count,
            unsortedCount: data.unsortedCount || 0,
            totalPhotos: data.count + (data.unsortedCount || 0),
            photosByRank: data.photosByRank
        };
    });
    
    // Sort folders by average rank (descending)
    sortedFolders.sort((a, b) => b.averageRank - a.averageRank);
    
    return sortedFolders;
}

// Function to write folder rankings to a CSV file
function writeFolderRankingsToCSV(sortedFolders) {
    console.log('Writing folder rankings to CSV file...');
    
    const csvFilePath = path.join(baseDir, 'folder_rankings.csv');
    
    // Create CSV header
    let csvContent = 'Folder,AverageRank,SortedPhotos,UnsortedPhotos,TotalPhotos,Rank5,Rank4,Rank3,Rank2,Rank1\n';
    
    // Add data for each folder
    sortedFolders.forEach(folder => {
        const folderPath = folder.folderPath.replace(/,/g, '_'); // Replace commas to avoid CSV issues
        const averageRank = folder.averageRank.toFixed(2);
        const sortedPhotos = folder.photoCount;
        const unsortedPhotos = folder.unsortedCount;
        const totalPhotos = folder.totalPhotos;
        
        // Get counts for each rank
        const rank5 = folder.photosByRank[5] || 0;
        const rank4 = folder.photosByRank[4] || 0;
        const rank3 = folder.photosByRank[3] || 0;
        const rank2 = folder.photosByRank[2] || 0;
        const rank1 = folder.photosByRank[1] || 0;
        
        // Add row to CSV
        csvContent += `${folderPath},${averageRank},${sortedPhotos},${unsortedPhotos},${totalPhotos},${rank5},${rank4},${rank3},${rank2},${rank1}\n`;
    });
    
    // Write to file
    try {
        fs.writeFileSync(csvFilePath, csvContent);
        console.log(`Folder rankings written to: ${csvFilePath}`);
    } catch (err) {
        console.error('Error writing CSV file:', err);
    }
}

// Function to calculate and print average folder ranks
function calculateAndPrintFolderRanks() {
    console.log('\nCalculating average folder ranks...');
    
    // Get folder ranks data
    const sortedFolders = getFolderRanksData();
    
    // Write to CSV file
    writeFolderRankingsToCSV(sortedFolders);
    
    // Print the results
    console.log('\nFolders sorted by average rank:');
    console.log('==============================');
    
    if (sortedFolders.length === 0) {
        console.log('No folders with photos found.');
    } else {
        sortedFolders.forEach(folder => {
            console.log(`Folder: ${folder.folderPath}`);
            console.log(`  Average Rank: ${folder.averageRank.toFixed(2)}`);
            console.log(`  Sorted Photos: ${folder.photoCount}`);
            console.log(`  Unsorted Photos: ${folder.unsortedCount}`);
            console.log(`  Total Photos: ${folder.totalPhotos}`);
            console.log(`  Distribution:`);
            
            // Print distribution of photos by rank
            for (let rank = 5; rank >= 1; rank--) {
                const count = folder.photosByRank[rank] || 0;
                const percentage = folder.photoCount > 0 ? ((count / folder.photoCount) * 100).toFixed(1) : '0.0';
                const bar = '█'.repeat(Math.round(percentage / 5));
                console.log(`    Rank ${rank}: ${count} photos (${percentage}%) ${bar}`);
            }
            
            // Print unsorted photos as a separate category if there are any
            if (folder.unsortedCount > 0) {
                const unsortedPercentage = ((folder.unsortedCount / folder.totalPhotos) * 100).toFixed(1);
                const unsortedBar = '█'.repeat(Math.round(unsortedPercentage / 5));
                console.log(`    Unsorted: ${folder.unsortedCount} photos (${unsortedPercentage}%) ${unsortedBar}`);
            }
            console.log('------------------------------');
        });
    }
    console.log('\n');
}

// Initial cache refresh
refreshPhotoCache();

// Calculate and print folder ranks after cache refresh
calculateAndPrintFolderRanks();

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
    
    // Get folder ranks data for the response
    const folderRanks = getFolderRanksData();
    
    res.json({
        success: true,
        basePhotos: photoCache.base.length,
        sortedPhotos: Object.keys(photoCache.sorted).reduce((total, key) => total + photoCache.sorted[key].length, 0),
        folderRanks: folderRanks
    });
});

// Add an endpoint to get folder ranks
app.get('/folder-ranks', (req, res) => {
    const folderRanks = getFolderRanksData();
    res.json(folderRanks);
});

// Add an endpoint to download folder rankings as CSV
app.get('/download-folder-rankings', (req, res) => {
    // Get folder ranks data
    const sortedFolders = getFolderRanksData();
    
    // Create CSV content
    let csvContent = 'Folder,AverageRank,SortedPhotos,UnsortedPhotos,TotalPhotos,Rank5,Rank4,Rank3,Rank2,Rank1\n';
    
    // Add data for each folder
    sortedFolders.forEach(folder => {
        const folderPath = folder.folderPath.replace(/,/g, '_'); // Replace commas to avoid CSV issues
        const averageRank = folder.averageRank.toFixed(2);
        const sortedPhotos = folder.photoCount;
        const unsortedPhotos = folder.unsortedCount;
        const totalPhotos = folder.totalPhotos;
        
        // Get counts for each rank
        const rank5 = folder.photosByRank[5] || 0;
        const rank4 = folder.photosByRank[4] || 0;
        const rank3 = folder.photosByRank[3] || 0;
        const rank2 = folder.photosByRank[2] || 0;
        const rank1 = folder.photosByRank[1] || 0;
        
        // Add row to CSV
        csvContent += `${folderPath},${averageRank},${sortedPhotos},${unsortedPhotos},${totalPhotos},${rank5},${rank4},${rank3},${rank2},${rank1}\n`;
    });
    
    // Set headers for CSV download
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=folder_rankings.csv');
    
    // Send the CSV content
    res.send(csvContent);
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
