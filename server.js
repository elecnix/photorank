require('dotenv').config();
const express = require('express');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const sharp = require('sharp');
const crypto = require('crypto');

// Precompile regex for image extensions to avoid recompilation on each file check
const imageExtensions = /\.(jpg|jpeg|png|gif|bmp)$/i;

const app = express();
const PORT = process.env.PORT || 6900;

// Get base directory from environment or use default
const baseDir = process.env.PHOTO_BASE_DIR || path.join(__dirname, 'photos');

// Thumbnail cache directory
const thumbnailCacheDir = process.env.THUMBNAIL_CACHE_DIR || path.join(__dirname, 'thumbnail-cache');

// Helper function to get cache directory structure based on MD5
function getCachePath(originalPath) {
    const hash = crypto.createHash('md5').update(originalPath).digest('hex');
    const first = hash.substring(0, 2);
    const second = hash.substring(2, 4);
    return path.join(thumbnailCacheDir, first, second);
}

// Helper function to get thumbnail file path
function getThumbnailPath(originalPath) {
    const hash = crypto.createHash('md5').update(originalPath).digest('hex');
    const first = hash.substring(0, 2);
    const second = hash.substring(2, 4);
    const filename = hash + '.jpg';
    return path.join(thumbnailCacheDir, first, second, filename);
}

// Helper function to ensure cache directory exists
function ensureCacheDirectory(originalPath) {
    const cacheDir = getCachePath(originalPath);
    if (!fs.existsSync(cacheDir)) {
        fs.mkdirSync(cacheDir, { recursive: true });
    }
    return cacheDir;
}

// Map to track ongoing thumbnail generation to prevent duplicates
const generatingThumbnails = new Map();

// Thumbnail generation queue (LIFO - Last In, First Out)
let thumbnailQueue = [];
let isProcessingQueue = false;

class ThumbnailRequest {
    constructor(inputPath, outputPath, resolve, reject) {
        this.inputPath = inputPath;
        this.outputPath = outputPath;
        this.resolve = resolve;
        this.reject = reject;
        this.timestamp = Date.now();
    }
}

// Process the next thumbnail in the queue
async function processThumbnailQueue() {
    if (isProcessingQueue || thumbnailQueue.length === 0) {
        return;
    }

    isProcessingQueue = true;

    while (thumbnailQueue.length > 0) {
        const request = thumbnailQueue.shift(); // FIFO for processing, but LIFO for adding

        try {
            console.log(`Processing thumbnail: ${request.outputPath}`);
            await generateThumbnail(request.inputPath, request.outputPath);
            request.resolve();
        } catch (error) {
            console.error('Error processing thumbnail request:', error);
            request.reject(error);
        }
    }

    isProcessingQueue = false;
}

// Add thumbnail request to queue (LIFO - add to front)
function queueThumbnailRequest(inputPath, outputPath) {
    return new Promise((resolve, reject) => {
        const request = new ThumbnailRequest(inputPath, outputPath, resolve, reject);

        // Add to front of queue (LIFO)
        thumbnailQueue.unshift(request);

        console.log(`Queued thumbnail request (LIFO): ${outputPath}, queue length: ${thumbnailQueue.length}`);

        // Start processing if not already processing
        processThumbnailQueue();
    });
}

// Database setup
const dbPath = path.join(__dirname, 'photos.db');
const db = new sqlite3.Database(dbPath, (err) => {
    if (err) {
        console.error('Error opening database:', err);
    } else {
        console.log('Connected to SQLite database');
    }
});

// Configure SQLite for better concurrency
db.serialize(() => {
    // Enable WAL mode for better concurrent reads
    db.run('PRAGMA journal_mode = WAL', (err) => {
        if (err) console.error('Error setting WAL mode:', err);
    });
    
    // Increase cache size
    db.run('PRAGMA cache_size = 10000', (err) => {
        if (err) console.error('Error setting cache size:', err);
    });
    
    // Reduce synchronous mode for better performance
    db.run('PRAGMA synchronous = NORMAL', (err) => {
        if (err) console.error('Error setting synchronous mode:', err);
    });
    
    // Initialize database tables
    db.run(`CREATE TABLE IF NOT EXISTS photos (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        path TEXT NOT NULL,
        location TEXT NOT NULL,
        UNIQUE(path, location)
    )`);
});

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

// Flag to track if initial background refresh is running
let isInitialBackgroundRefresh = false;
let backgroundRefreshPromise = null;

// Flag to prevent concurrent cache refreshes
let isRefreshingCache = false;
let currentRefreshPromise = null;

// Function to refresh the photo cache
async function refreshPhotoCache() {
    // If a refresh is already in progress, wait for it to complete
    if (isRefreshingCache && currentRefreshPromise) {
        console.log('Cache refresh already in progress, waiting...');
        return currentRefreshPromise;
    }
    
    // Start the refresh operation
    isRefreshingCache = true;
    currentRefreshPromise = (async () => {
        const startTime = Date.now();
        try {
            console.log('Performing incremental photo cache update...');
            
            // Recursively find all photo files in a directory and its subdirectories
            const findPhotosRecursively = async (dir, relativeTo) => {
                let photos = [];
                try {
                    const files = await fs.promises.readdir(dir, { withFileTypes: true });
                    
                    // Process files with limited concurrency to avoid overwhelming the system
                    const concurrencyLimit = 10;
                    for (let i = 0; i < files.length; i += concurrencyLimit) {
                        const batch = files.slice(i, i + concurrencyLimit);
                        const batchPromises = batch.map(async file => {
                            if (file.name === '@eaDir') return;
                            const fullPath = path.join(dir, file.name);
                            
                            // Skip the 'sorted' directory when scanning the base directory
                            if (dir === baseDir && file.name === 'sorted') {
                                return;
                            }
                            
                            if (file.isDirectory()) {
                                // Recursively search subdirectories
                                const subPhotos = await findPhotosRecursively(fullPath, relativeTo);
                                photos.push(...subPhotos);
                            } else if (file.isFile() && imageExtensions.test(file.name)) {
                                // Add photo files, preserving relative path from the relative directory
                                const relativePath = path.relative(relativeTo, fullPath);
                                photos.push(relativePath);
                            }
                        });
                        
                        await Promise.all(batchPromises);
                    }
                } catch (err) {
                    console.error(`Error reading directory ${dir}:`, err);
                }
                
                return photos;
            };
            
            // Get current database state
            const existingPhotos = await new Promise((resolve, reject) => {
                db.all('SELECT path, location FROM photos', (err, rows) => {
                    if (err) reject(err);
                    else resolve(rows || []);
                });
            });
            
            // Create a map of existing photos for quick lookup
            const existingPhotoMap = new Map();
            existingPhotos.forEach(photo => {
                existingPhotoMap.set(`${photo.location}:${photo.path}`, true);
            });
            
            // Scan filesystem for current photos
            const currentBasePhotos = await findPhotosRecursively(baseDir, baseDir);
            const currentSortedPhotos = {};
            
            for (const key of Object.keys(sortedDirs)) {
                currentSortedPhotos[key] = await findPhotosRecursively(sortedDirs[key], sortedDirs[key]);
            }
            
            // Find photos that exist on filesystem but not in database (new photos to add)
            const photosToAdd = [];
            
            // Check base photos
            currentBasePhotos.forEach(photoPath => {
                if (!existingPhotoMap.has(`base:${photoPath}`)) {
                    photosToAdd.push({ path: photoPath, location: 'base' });
                }
            });
            
            // Check sorted photos
            Object.keys(sortedDirs).forEach(key => {
                currentSortedPhotos[key].forEach(photoPath => {
                    if (!existingPhotoMap.has(`sorted/${key}:${photoPath}`)) {
                        photosToAdd.push({ path: photoPath, location: `sorted/${key}` });
                    }
                });
            });
            
            // Find photos that exist in database but not on filesystem (stale entries to remove)
            const photosToRemove = [];
            
            existingPhotos.forEach(photo => {
                let stillExists = false;
                
                if (photo.location === 'base') {
                    stillExists = currentBasePhotos.includes(photo.path);
                } else if (photo.location.startsWith('sorted/')) {
                    const key = photo.location.split('/')[1];
                    stillExists = currentSortedPhotos[key] && currentSortedPhotos[key].includes(photo.path);
                }
                
                if (!stillExists) {
                    photosToRemove.push(photo);
                }
            });
            
            // Perform database updates
            console.log(`Adding ${photosToAdd.length} new photos, removing ${photosToRemove.length} stale entries...`);
            
            // Add new photos
            if (photosToAdd.length > 0) {
                const chunkSize = 100; // Reduced from 2000 to prevent blocking
                for (let i = 0; i < photosToAdd.length; i += chunkSize) {
                    const chunk = photosToAdd.slice(i, i + chunkSize);
                    console.log(`Adding chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(photosToAdd.length/chunkSize)} (${chunk.length} photos)`);
                    
                    // Process sequentially to avoid database blocking
                    for (const photo of chunk) {
                        if (!photo.path || photo.path.trim() === '') {
                            console.warn('Skipping photo with empty path:', photo);
                            continue;
                        }
                        
                        await new Promise((resolve, reject) => {
                            db.run(
                                'INSERT OR IGNORE INTO photos (path, location) VALUES (?, ?)',
                                [photo.path, photo.location],
                                (err) => {
                                    if (err) reject(err);
                                    else resolve();
                                }
                            );
                        });
                    }
                    
                    // Small delay between chunks to allow other operations
                    if (i + chunkSize < photosToAdd.length) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }
                console.log(`Added ${photosToAdd.length} new photos to database`);
            }
            
            // Remove stale photos
            if (photosToRemove.length > 0) {
                const chunkSize = 50; // Reduced from 1000 to prevent blocking
                for (let i = 0; i < photosToRemove.length; i += chunkSize) {
                    const chunk = photosToRemove.slice(i, i + chunkSize);
                    console.log(`Removing chunk ${Math.floor(i/chunkSize) + 1}/${Math.ceil(photosToRemove.length/chunkSize)} (${chunk.length} photos)`);
                    
                    // Process sequentially to avoid database blocking
                    for (const photo of chunk) {
                        await new Promise((resolve, reject) => {
                            db.run('DELETE FROM photos WHERE path = ? AND location = ?', [photo.path, photo.location], (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    }
                    
                    // Small delay between chunks to allow other operations
                    if (i + chunkSize < photosToRemove.length) {
                        await new Promise(resolve => setTimeout(resolve, 10));
                    }
                }
                console.log(`Removed ${photosToRemove.length} stale photos from database`);
            }
            
            // Log final counts
            const finalBaseCount = currentBasePhotos.length;
            console.log(`Base directory: ${finalBaseCount} photos`);
            Object.keys(sortedDirs).forEach(key => {
                const sortedCount = currentSortedPhotos[key].length;
                console.log(`Sorted/${key}: ${sortedCount} photos`);
            });
            
            // Calculate and print folder ranks after cache update
            // calculateAndPrintFolderRanks(); // Disabled for faster startup
        } catch (error) {
            console.error('Error in refreshPhotoCache:', error);
            // Don't rethrow - just log the error to prevent server crash
        } finally {
            const endTime = Date.now();
            console.log(`Photo cache updated in ${endTime - startTime}ms`);
            // Always reset the flag when done
            isRefreshingCache = false;
            currentRefreshPromise = null;
        }
    })();
    
    return currentRefreshPromise;
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
ensureDirectoryExists(thumbnailCacheDir);

// Function to get folder ranks data
function getFolderRanksData() {
    return new Promise((resolve, reject) => {
        // Create a map to store folder information
        const folderRanks = new Map();
        
        // Query all photos from database
        db.all('SELECT path, location FROM photos', (err, rows) => {
            if (err) {
                console.error('Error querying photos:', err);
                reject(err);
                return;
            }
            
            // Process photos from all sorted directories
            rows.filter(row => row.location.startsWith('sorted/')).forEach(row => {
                const rankNum = parseInt(row.location.split('/')[1]);
                
                const photoPath = row.path;
                // Extract the folder path from the photo path
                const folderPath = path.dirname(photoPath);
                if (folderPath === '.') return; // Skip photos directly in the sorted directory
                
                // Process the current folder and all parent folders
                processFolder(folderPath, rankNum, folderRanks);
            });
            
            // Process photos from base directory to count unsorted photos per folder
            rows.filter(row => row.location === 'base').forEach(row => {
                const photoPath = row.path;
                // Extract the folder path from the photo path
                const folderPath = path.dirname(photoPath);
                if (folderPath === '.') return; // Skip photos directly in the base directory
                
                // Process the current folder and all parent folders for unsorted photos
                processUnsortedFolder(folderPath, folderRanks);
            });
            
            // Convert map to array for sorting
            const sortedFolders = Array.from(folderRanks.entries()).map(([folderPath, data]) => {
                return {
                    folderPath,
                    averageRank: data.count > 0 ? data.totalRank / data.count : 0,
                    photoCount: data.count,
                    unsortedCount: data.unsortedCount || 0,
                    totalPhotos: data.count + (data.unsortedCount || 0),
                    photosByRank: data.photosByRank,
                    depth: folderPath.split('/').length // Add depth information
                };
            });
            
            // Sort folders by average rank (descending) and then by depth (ascending)
            sortedFolders.sort((a, b) => {
                // First sort by average rank
                const rankDiff = b.averageRank - a.averageRank;
                if (Math.abs(rankDiff) > 0.001) { // Use a small epsilon for floating point comparison
                    return rankDiff;
                }
                // If ranks are equal, sort by depth (shallower folders first)
                return a.depth - b.depth;
            });
            
            resolve(sortedFolders);
        });
    });
}

function normalizeFolderPath(folderPath, maxDepth) {
    if (!folderPath || folderPath === '.') return folderPath;
    const parts = folderPath.split('/').filter(Boolean);
    if (parts.length <= maxDepth) return parts.join('/');
    return parts.slice(0, maxDepth).join('/');
}

// Helper function to process a folder and all its parent folders for ranked photos
function processFolder(folderPath, rankNum, folderRanks) {
    const normalizedFolderPath = normalizeFolderPath(folderPath, 2);
    // Process the current folder
    updateFolderRank(normalizedFolderPath, rankNum, folderRanks);
    
    // Process all parent folders up to the root
    let currentPath = normalizedFolderPath;
    while (currentPath.includes('/')) {
        currentPath = path.dirname(currentPath);
        if (currentPath === '.') break; // Stop at the root
        updateFolderRank(currentPath, rankNum, folderRanks);
    }
}

// Helper function to update a folder's rank information
function updateFolderRank(folderPath, rankNum, folderRanks) {
    // Create a unique key for the folder
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
}

// Helper function to process a folder and all its parent folders for unsorted photos
function processUnsortedFolder(folderPath, folderRanks) {
    const normalizedFolderPath = normalizeFolderPath(folderPath, 2);
    // Process the current folder
    updateFolderUnsorted(normalizedFolderPath, folderRanks);
    
    // Process all parent folders up to the root
    let currentPath = normalizedFolderPath;
    while (currentPath.includes('/')) {
        currentPath = path.dirname(currentPath);
        if (currentPath === '.') break; // Stop at the root
        updateFolderUnsorted(currentPath, folderRanks);
    }
}

// Helper function to update a folder's unsorted count
function updateFolderUnsorted(folderPath, folderRanks) {
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
}

// Function to write folder rankings to a CSV file
function writeFolderRankingsToCSV(sortedFolders) {
    console.log('Writing folder rankings to CSV file...');
    
    const csvFilePath = path.join(baseDir, 'folder_rankings.csv');
    
    // Create CSV header
    let csvContent = 'Folder,Depth,AverageRank,SortedPhotos,UnsortedPhotos,TotalPhotos,Rank5,Rank4,Rank3,Rank2,Rank1\n';
    
    // Add data for each folder
    sortedFolders.forEach(folder => {
        const folderPath = folder.folderPath.replace(/,/g, '_'); // Replace commas to avoid CSV issues
        const depth = folder.depth || folderPath.split('/').length;
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
        csvContent += `${folderPath},${depth},${averageRank},${sortedPhotos},${unsortedPhotos},${totalPhotos},${rank5},${rank4},${rank3},${rank2},${rank1}\n`;
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
async function calculateAndPrintFolderRanks() {
    console.log('\nCalculating average folder ranks...');
    
    try {
        // Get folder ranks data
        const sortedFolders = await getFolderRanksData();
        
        // Write to CSV file
        writeFolderRankingsToCSV(sortedFolders);
        
        // Print the results
        console.log('\nFolders sorted by average rank:');
        console.log('==============================');
        
        if (sortedFolders.length === 0) {
            console.log('No folders with photos found.');
        } else {
            sortedFolders.forEach(folder => {
                if (folder.photoCount === folder.totalPhotos) return;
                console.log(`Folder: ${folder.folderPath}`);
                const sortedRatio = folder.photoCount / folder.totalPhotos;
                console.log(`  Average Rank: ${folder.averageRank.toFixed(2)}, Sorted Photos: ${folder.photoCount} of ${folder.totalPhotos} (${sortedRatio.toFixed(2) * 100}%)`);
            });
        }
        console.log('\n');
    } catch (error) {
        console.error('Error calculating folder ranks:', error);
    }
}

// Recommend moving remaining low-score folders to sorted/1
// or high-scoring folders to sorted/4
async function printMassActions() {
    try {
        const sortedFolders = await getFolderRanksData();
        console.log(`Mass action recommendations:`);
        sortedFolders.forEach(folder => {
            const sortedRatio = folder.photoCount / folder.totalPhotos;
            const averageRank = folder.averageRank;
            if (averageRank < 3 && sortedRatio > 0.2 && sortedRatio < 1.0) {
                console.log(`target='sorted/1/${folder.folderPath}' ; mkdir -p "$target" ; cp -r '${folder.folderPath}'/* "$target/" && rm -rf '${folder.folderPath}' # average rank ${averageRank}, sorted ${folder.photoCount}/${folder.totalPhotos} (${(sortedRatio * 100).toFixed(2)}%)`);
            }
            if (averageRank > 3 && sortedRatio > 0.4 && sortedRatio < 1.0) {
                console.log(`target='sorted/4/${folder.folderPath}' ; mkdir -p "$target" ; cp -r '${folder.folderPath}'/* "$target/" && rm -rf '${folder.folderPath}' # average rank ${averageRank}, sorted ${folder.photoCount}/${folder.totalPhotos} (${(sortedRatio * 100).toFixed(2)}%)`);
            }
        });
    } catch (error) {
        console.error('Error printing mass actions:', error);
    }
}

// Initial server startup
(async () => {
    // Start the server immediately to serve existing database content
    app.listen(PORT, () => {
        console.log(`Server is running on http://localhost:${PORT}`);
        console.log('Serving photos from existing SQLite database...');

        // Mark that initial background refresh is starting
        isInitialBackgroundRefresh = true;

        // Start the background refresh without blocking
        // Use setImmediate to make it truly non-blocking
        setImmediate(() => {
            refreshPhotoCache().then(() => {
                console.log('Initial cache refresh completed');
                isInitialBackgroundRefresh = false;
                // return printMassActions(); // Disabled for faster startup
                return Promise.resolve();
            }).then(() => {
                // console.log('Mass actions calculated'); // Disabled for faster startup
            }).catch((error) => {
                console.error('Error during background cache refresh:', error);
                isInitialBackgroundRefresh = false;
                // Don't throw the error - just log it to prevent server crash
            });
        });
    });
})();


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

// Function to get a random photo from the database
function getRandomPhoto() {
    return new Promise(async (resolve, reject) => {
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
    
    // Helper function to select a folder based on probability distribution
    function selectFolderByProbability() {
        // Define probabilities for each folder (in percentage)
        const probabilities = {
            '1': 0,
            '2': 20,
            '3': 30,
            '4': 30,
            '5': 20
        };
        
        // Generate a random number between 0 and 100
        const randomNum = Math.random() * 100;
        
        // Determine which folder to select based on the random number
        let cumulativeProbability = 0;
        for (const [folder, probability] of Object.entries(probabilities)) {
            cumulativeProbability += probability;
            if (randomNum <= cumulativeProbability) {
                return folder;
            }
        }
        
        // Default to folder 3 if something goes wrong
        return '3';
    }
    
    // Function to try getting a photo from a specific location
    function tryGetPhotoFromLocation(location) {
        return new Promise((resolveTry) => {
            db.all('SELECT path FROM photos WHERE location = ?', [location], (err, rows) => {
                if (err || rows.length === 0) {
                    resolveTry(null);
                    return;
                }
                
                // Try up to 5 random photos from this location
                for (let i = 0; i < 5; i++) {
                    const randomRow = getRandomFromArray(rows);
                    if (!randomRow) continue;
                    
                    const photo = randomRow.path;
                    const directory = location === 'base' ? '' : location;
                    
                    if (verifyPhotoExists(photo, directory)) {
                        resolveTry({ photo, directory });
                        return;
                    } else {
                        // Remove invalid photo from database
                        db.run('DELETE FROM photos WHERE path = ? AND location = ?', [photo, location]);
                    }
                }
                
                resolveTry(null);
            });
        });
    }
    
    // Function to wait for at least one photo to be indexed into the database
    function waitForFirstPhoto() {
        return new Promise((resolve, reject) => {
            const maxWaitTime = 3000; // Reduced to 3 seconds max wait
            const checkInterval = 100; // Check every 100ms
            let elapsedTime = 0;
            
            const checkPhotos = () => {
                db.get('SELECT COUNT(*) as count FROM photos', (err, row) => {
                    if (err) {
                        reject(err);
                        return;
                    }
                    
                    const count = row.count || 0;
                    if (count > 0) {
                        console.log(`First photo indexed after ${elapsedTime}ms (${count} total photos)`);
                        resolve();
                        return;
                    }
                    
                    elapsedTime += checkInterval;
                    if (elapsedTime >= maxWaitTime) {
                        console.log('Timeout waiting for first photo - proceeding without photos');
                        resolve(); // Resolve even if no photos, to prevent blocking
                        return;
                    }
                    
                    // Continue checking
                    setTimeout(checkPhotos, checkInterval);
                });
            };
            
            // Start checking
            checkPhotos();
        });
    }
    
    // Helper function to try sources in order
    async function tryPreferredSources(sources) {
        for (const source of sources) {
            if (source === 'base') {
                const baseResult = await tryGetPhotoFromLocation('base');
                if (baseResult) return baseResult;
            } else if (source === 'sorted') {
                // Try sorted photos using the existing logic
                const availableFolders = await new Promise((resolveCount) => {
                    db.all('SELECT DISTINCT location FROM photos WHERE location LIKE "sorted/%"', (err, rows) => {
                        if (err) {
                            resolveCount([]);
                            return;
                        }
                        resolveCount(rows.map(row => row.location.split('/')[1]).filter(key => key));
                    });
                });
                
                if (availableFolders.length > 0) {
                    // Try to select folders based on probability
                    const triedFolders = new Set();
                    while (triedFolders.size < 5 && availableFolders.length > triedFolders.size) {
                        const selectedFolder = selectFolderByProbability();
                        
                        if (triedFolders.has(selectedFolder) || !availableFolders.includes(selectedFolder)) {
                            triedFolders.add(selectedFolder);
                            continue;
                        }
                        
                        const sortedResult = await tryGetPhotoFromLocation(`sorted/${selectedFolder}`);
                        if (sortedResult) return sortedResult;
                        
                        triedFolders.add(selectedFolder);
                    }
                }
            }
        }
        return null;
    }
    
    try {
        // Decide if we should prefer already-sorted photos (20% chance)
        const preferSorted = Math.random() < 0.20;
        
        let result = null;
        
        // Try preferred source first, then fallback to the other
        if (preferSorted) {
            result = await tryPreferredSources(['sorted', 'base']);
        } else {
            result = await tryPreferredSources(['base', 'sorted']);
        }
        
        if (result) {
            return resolve({ photo: result.photo, directory: result.directory });
        }
        
        // Check if we have ANY photos in the database at all
        const totalPhotos = await new Promise((resolveCount) => {
            db.get('SELECT COUNT(*) as count FROM photos', (err, row) => {
                if (err) {
                    resolveCount(0);
                    return;
                }
                resolveCount(row.count || 0);
            });
        });
        
        // If database is completely empty, trigger a refresh but don't block for too long
        if (totalPhotos === 0) {
            if (isInitialBackgroundRefresh && backgroundRefreshPromise) {
                console.log('Database is empty, waiting briefly for first photo to be indexed...');
                const startWait = Date.now();
                try {
                    // Wait for at least one photo to appear in database
                    await waitForFirstPhoto();
                } catch (error) {
                    console.error('Waiting for first photo failed:', error);
                }
                console.log(`Waited ${Date.now() - startWait}ms for first photo during initial refresh`);
                // Try again now that at least one photo should be available
                const retryResult = await tryGetPhotoFromLocation('base');
                if (retryResult) {
                    return resolve({ photo: retryResult.photo, directory: retryResult.directory });
                }
            } else if (isRefreshingCache && currentRefreshPromise) {
                console.log('Database is empty, waiting briefly for first photo to be indexed from ongoing refresh...');
                const startWait = Date.now();
                try {
                    // Wait for at least one photo to appear in database
                    await waitForFirstPhoto();
                } catch (error) {
                    console.error('Waiting for first photo failed:', error);
                }
                console.log(`Waited ${Date.now() - startWait}ms for first photo during ongoing refresh`);
                // Try again now that at least one photo should be available
                const retryResult = await tryGetPhotoFromLocation('base');
                if (retryResult) {
                    return resolve({ photo: retryResult.photo, directory: retryResult.directory });
                }
            } else {
                // No refresh running and database is empty, trigger our own refresh but don't wait
                console.log('Database is empty, starting refresh in background...');
                refreshPhotoCache(); // Start refresh in background without waiting
                
                // Try once more quickly in case refresh is very fast
                const retryResult = await tryGetPhotoFromLocation('base');
                if (retryResult) {
                    return resolve({ photo: retryResult.photo, directory: retryResult.directory });
                }
            }
        } else {
            // Database has photos but they're not valid (stale), trigger refresh
            console.log('Database has photos but none are valid, triggering refresh');
            await refreshPhotoCache();
            
            // Try again after refresh
            const retryResult = await tryGetPhotoFromLocation('base');
            if (retryResult) {
                return resolve({ photo: retryResult.photo, directory: retryResult.directory });
            }
        }
        
        // If we get here, no photos were found anywhere
        return reject(new Error('No photos found in any directory'));
    } catch (err) {
        reject(err);
    }
    }); // Close the Promise
}

app.get('/random-photo', async (req, res) => {
    try {
        const { photo, directory } = await getRandomPhoto();
        res.json({ photo, directory });
    } catch (err) {
        console.error('Error getting random photo:', err);
        return res.status(500).send('Error getting random photo');
    }
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
        
        // Update the database after moving the photo sequentially to avoid race conditions
        (async () => {
            try {
                if (!directory || directory === '') {
                    // Remove from base location
                    await new Promise((resolve, reject) => {
                        db.run('DELETE FROM photos WHERE path = ? AND location = ?', [photo, 'base'], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    // Add to sorted/4 location
                    await new Promise((resolve, reject) => {
                        db.run('INSERT INTO photos (path, location) VALUES (?, ?)', [photo, 'sorted/4'], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                } else if (directory.includes('sorted')) {
                    // Extract current rank from the directory path
                    const currentRank = parseInt(directory.split('/').pop());
                    if (!isNaN(currentRank)) {
                        // Remove from current sorted location
                        await new Promise((resolve, reject) => {
                            db.run('DELETE FROM photos WHERE path = ? AND location = ?', [photo, `sorted/${currentRank}`], (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                        // Add to new sorted location
                        const newRank = Math.min(currentRank + 1, 5);
                        await new Promise((resolve, reject) => {
                            db.run('INSERT INTO photos (path, location) VALUES (?, ?)', [photo, `sorted/${newRank}`], (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    }
                }
            } catch (err) {
                console.error('Error updating database after like:', err);
            }
        })();
        
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
        
        // Update the database after moving the photo sequentially to avoid race conditions
        (async () => {
            try {
                if (!directory || directory === '') {
                    // Remove from base location
                    await new Promise((resolve, reject) => {
                        db.run('DELETE FROM photos WHERE path = ? AND location = ?', [photo, 'base'], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                    // Add to sorted/2 location
                    await new Promise((resolve, reject) => {
                        db.run('INSERT INTO photos (path, location) VALUES (?, ?)', [photo, 'sorted/2'], (err) => {
                            if (err) reject(err);
                            else resolve();
                        });
                    });
                } else if (directory.includes('sorted')) {
                    // Extract current rank from the directory path
                    const currentRank = parseInt(directory.split('/').pop());
                    if (!isNaN(currentRank)) {
                        // Remove from current sorted location
                        await new Promise((resolve, reject) => {
                            db.run('DELETE FROM photos WHERE path = ? AND location = ?', [photo, `sorted/${currentRank}`], (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                        // Add to new sorted location
                        const newRank = Math.max(currentRank - 1, 1);
                        await new Promise((resolve, reject) => {
                            db.run('INSERT INTO photos (path, location) VALUES (?, ?)', [photo, `sorted/${newRank}`], (err) => {
                                if (err) reject(err);
                                else resolve();
                            });
                        });
                    }
                }
            } catch (err) {
                console.error('Error updating database after dislike:', err);
            }
        })();
        
        res.send('Photo disliked');
    });
});

// Add endpoint for direct rating (1-5)
app.post('/rate', async (req, res) => {
    const { photo, directory, rating } = req.body;
    if (!photo || rating === undefined) {
        return res.status(400).send('Missing photo or rating');
    }
    
    // Validate rating is between 1 and 5
    if (rating < 1 || rating > 5 || !Number.isInteger(rating)) {
        return res.status(400).send('Rating must be an integer between 1 and 5');
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
    
    // Determine the target directory based on the rating
    let targetDir = sortedDirs[rating];
    
    try {
        // Move the photo from source to target directory
        const sourcePath = path.join(sourceDir, photo);
        const targetPath = path.join(targetDir, photo);
        
        // Check if source file exists
        if (!fs.existsSync(sourcePath)) {
            return res.status(404).send('Source photo not found');
        }
        
        // Ensure target directory exists (including subdirectories)
        const targetFileDir = path.dirname(targetPath);
        if (!fs.existsSync(targetFileDir)) {
            fs.mkdirSync(targetFileDir, { recursive: true });
        }
        
        // Move the file
        fs.renameSync(sourcePath, targetPath);
        
        // Update database
        if (!directory || directory === '') {
            // Remove from base location
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM photos WHERE path = ? AND location = ?', [photo, 'base'], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            // Add to sorted location
            await new Promise((resolve, reject) => {
                db.run('INSERT INTO photos (path, location) VALUES (?, ?)', [photo, `sorted/${rating}`], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        } else if (directory.includes('sorted')) {
            // Remove from current sorted location
            await new Promise((resolve, reject) => {
                db.run('DELETE FROM photos WHERE path = ? AND location = ?', [photo, directory], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
            // Add to new sorted location
            await new Promise((resolve, reject) => {
                db.run('INSERT INTO photos (path, location) VALUES (?, ?)', [photo, `sorted/${rating}`], (err) => {
                    if (err) reject(err);
                    else resolve();
                });
            });
        }
        
        console.log(`Rated photo ${photo} as ${rating}`);
        res.send(`Photo rated as ${rating}`);
    } catch (error) {
        console.error('Error rating photo:', error);
        res.status(500).send('Error rating photo');
    }
});

// Add an endpoint to refresh the cache manually
app.get('/refresh-cache', async (req, res) => {
    try {
        await refreshPhotoCache();
        
        // Get folder ranks data for the response
        const folderRanks = await getFolderRanksData();
        
        // Get photo counts from database
        db.get('SELECT COUNT(*) as baseCount FROM photos WHERE location = "base"', (err, baseRow) => {
            if (err) {
                console.error('Error getting base count:', err);
                return res.status(500).send('Error getting photo counts');
            }
            
            db.get('SELECT COUNT(*) as sortedCount FROM photos WHERE location LIKE "sorted/%"', (err, sortedRow) => {
                if (err) {
                    console.error('Error getting sorted count:', err);
                    return res.status(500).send('Error getting photo counts');
                }
                
                res.json({
                    success: true,
                    basePhotos: baseRow.baseCount,
                    sortedPhotos: sortedRow.sortedCount,
                    folderRanks: folderRanks
                });
            });
        });
    } catch (error) {
        console.error('Error during manual cache refresh:', error);
        res.status(500).json({ 
            success: false, 
            error: 'Cache refresh failed but server is still running' 
        });
    }
});

// Add an endpoint to get folder ranks
app.get('/folder-ranks', async (req, res) => {
    try {
        const folderRanks = await getFolderRanksData();
        res.json(folderRanks);
    } catch (error) {
        console.error('Error getting folder ranks:', error);
        res.status(500).send('Error getting folder ranks');
    }
});

// Add an endpoint to get plot data for Plotly
app.get('/plot-data', async (req, res) => {
    try {
        const folderRanks = await getFolderRanksData();
        
        // Format data for Plotly scatter plot
        const plotData = folderRanks.map(folder => ({
            x: folder.totalPhotos,
            y: folder.averageRank,
            text: folder.folderPath,
            depth: folder.depth
        }));
        
        res.json(plotData);
    } catch (error) {
        console.error('Error getting plot data:', error);
        res.status(500).send('Error getting plot data');
    }
});

// Add route to serve the plot page
app.get('/plot', (req, res) => {
    res.sendFile(path.join(__dirname, 'plot.html'));
});

// API endpoint for folder ratings with drill-down capability
app.get('/api/folder-ratings', async (req, res) => {
    const parentFolder = req.query.folder || '';
    const startTime = Date.now();
    
    try {
        const results = await new Promise((resolve, reject) => {
            // Build the SQL query based on whether we're at root or inside a folder
            let query;
            let params = [];
            
            if (parentFolder === '') {
                // Root level: get top-level folders
                query = `
                    WITH folder_data AS (
                        SELECT 
                            CASE 
                                WHEN instr(path, '/') > 0 THEN substr(path, 1, instr(path, '/') - 1)
                                ELSE NULL
                            END as folder,
                            location,
                            path
                        FROM photos
                        WHERE location LIKE 'sorted/%'
                    )
                    SELECT 
                        folder,
                        SUM(CASE WHEN location = 'sorted/1' THEN 1 ELSE 0 END) as rank1,
                        SUM(CASE WHEN location = 'sorted/2' THEN 1 ELSE 0 END) as rank2,
                        SUM(CASE WHEN location = 'sorted/3' THEN 1 ELSE 0 END) as rank3,
                        SUM(CASE WHEN location = 'sorted/4' THEN 1 ELSE 0 END) as rank4,
                        SUM(CASE WHEN location = 'sorted/5' THEN 1 ELSE 0 END) as rank5,
                        COUNT(*) as total,
                        ROUND((1.0 * SUM(CASE WHEN location = 'sorted/1' THEN 1 ELSE 0 END) +
                               2.0 * SUM(CASE WHEN location = 'sorted/2' THEN 1 ELSE 0 END) +
                               3.0 * SUM(CASE WHEN location = 'sorted/3' THEN 1 ELSE 0 END) +
                               4.0 * SUM(CASE WHEN location = 'sorted/4' THEN 1 ELSE 0 END) +
                               5.0 * SUM(CASE WHEN location = 'sorted/5' THEN 1 ELSE 0 END)) / COUNT(*), 2) as avgRating
                    FROM folder_data
                    WHERE folder IS NOT NULL
                    GROUP BY folder
                    ORDER BY avgRating DESC, total DESC
                `;
            } else {
                // Inside a folder: get subfolders
                const folderPrefix = parentFolder + '/';
                const folderPrefixLen = folderPrefix.length;
                
                query = `
                    WITH folder_data AS (
                        SELECT 
                            CASE 
                                WHEN instr(substr(path, ? + 1), '/') > 0 
                                THEN substr(path, 1, ? + instr(substr(path, ? + 1), '/') - 1)
                                ELSE NULL
                            END as folder,
                            location,
                            path
                        FROM photos
                        WHERE location LIKE 'sorted/%' AND path LIKE ?
                    )
                    SELECT 
                        folder,
                        SUM(CASE WHEN location = 'sorted/1' THEN 1 ELSE 0 END) as rank1,
                        SUM(CASE WHEN location = 'sorted/2' THEN 1 ELSE 0 END) as rank2,
                        SUM(CASE WHEN location = 'sorted/3' THEN 1 ELSE 0 END) as rank3,
                        SUM(CASE WHEN location = 'sorted/4' THEN 1 ELSE 0 END) as rank4,
                        SUM(CASE WHEN location = 'sorted/5' THEN 1 ELSE 0 END) as rank5,
                        COUNT(*) as total,
                        ROUND((1.0 * SUM(CASE WHEN location = 'sorted/1' THEN 1 ELSE 0 END) +
                               2.0 * SUM(CASE WHEN location = 'sorted/2' THEN 1 ELSE 0 END) +
                               3.0 * SUM(CASE WHEN location = 'sorted/3' THEN 1 ELSE 0 END) +
                               4.0 * SUM(CASE WHEN location = 'sorted/4' THEN 1 ELSE 0 END) +
                               5.0 * SUM(CASE WHEN location = 'sorted/5' THEN 1 ELSE 0 END)) / COUNT(*), 2) as avgRating
                    FROM folder_data
                    WHERE folder IS NOT NULL
                    GROUP BY folder
                    ORDER BY avgRating DESC, total DESC
                `;
                params = [folderPrefixLen, folderPrefixLen, folderPrefixLen, folderPrefix + '%'];
            }
            
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        const duration = Date.now() - startTime;
        console.log(`Folder ratings query (folder: "${parentFolder}") took ${duration}ms, returned ${results.length} rows`);
        
        res.json({
            parentFolder,
            folders: results,
            queryTime: duration
        });
    } catch (error) {
        console.error('Error getting folder ratings:', error);
        res.status(500).json({ error: 'Error getting folder ratings' });
    }
});

// Thumbnail endpoint - generates and serves thumbnails on-demand using LIFO queue
app.get('/thumbnail/*', async (req, res) => {
    try {
        // Extract the image path from the URL
        const imagePath = req.params[0];
        if (!imagePath) {
            return res.status(400).send('No image path provided');
        }

        // Validate the image path to prevent directory traversal
        if (imagePath.includes('..') || imagePath.includes('\\')) {
            return res.status(400).send('Invalid image path');
        }

        // Construct the full path to the original image
        const fullPath = path.join(baseDir, imagePath);

        // Check if the original image exists
        if (!fs.existsSync(fullPath)) {
            return res.status(404).send('Image not found');
        }

        // Get the thumbnail path
        const thumbnailPath = getThumbnailPath(imagePath);

        // If thumbnail already exists, serve it immediately
        if (fs.existsSync(thumbnailPath)) {
            // Set cache headers for immutable thumbnails (1 year cache)
            res.set({
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Expires': new Date(Date.now() + 31536000000).toUTCString(), // 1 year from now
                'ETag': `"thumb-${crypto.createHash('md5').update(imagePath).digest('hex')}"`
            });
            return res.sendFile(thumbnailPath);
        }

        // Thumbnail doesn't exist, queue it for generation
        try {
            await queueThumbnailRequest(fullPath, thumbnailPath);

            // After generation, serve the thumbnail with cache headers
            res.set({
                'Cache-Control': 'public, max-age=31536000, immutable',
                'Expires': new Date(Date.now() + 31536000000).toUTCString(), // 1 year from now
                'ETag': `"thumb-${crypto.createHash('md5').update(imagePath).digest('hex')}"`
            });
            res.sendFile(thumbnailPath);
        } catch (error) {
            console.error('Error queuing thumbnail request:', error);
            res.status(500).send('Error generating thumbnail');
        }

    } catch (error) {
        console.error('Error serving thumbnail:', error);
        res.status(500).send('Error generating thumbnail');
    }
});

// Function to generate a thumbnail
async function generateThumbnail(inputPath, outputPath) {
    try {
        // Ensure the cache directory exists for the output path
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Generate thumbnail using sharp
        await sharp(inputPath)
            .resize(160, 160, { 
                fit: 'cover',
                position: 'center'
            })
            .jpeg({ 
                quality: 70,
                progressive: true
            })
            .toFile(outputPath);

        console.log(`Generated thumbnail: ${outputPath}`);
    } catch (error) {
        console.error('Error generating thumbnail:', error);
        throw error;
    }
}

// API endpoint to get top images for a folder
app.get('/api/folder-images', async (req, res) => {
    const folder = req.query.folder || '';
    const limit = req.query.limit ? parseInt(req.query.limit) : null; // null means get all images
    
    if (!folder) {
        return res.status(400).json({ error: 'Folder parameter required' });
    }
    
    try {
        const images = await new Promise((resolve, reject) => {
            // Get images from this exact folder (not subfolders), ordered by rating (highest first)
            const query = `
                SELECT path, location,
                    CASE location
                        WHEN 'sorted/5' THEN 5
                        WHEN 'sorted/4' THEN 4
                        WHEN 'sorted/3' THEN 3
                        WHEN 'sorted/2' THEN 2
                        WHEN 'sorted/1' THEN 1
                        ELSE 0
                    END as rating
                FROM photos
                WHERE location LIKE 'sorted/%' 
                    AND path LIKE ?
                    AND (
                        path = ? 
                        OR (path LIKE ? AND instr(substr(path, ?), '/') = 0)
                    )
                ORDER BY rating DESC, path ASC
                ${limit ? 'LIMIT ?' : ''}
            `;
            
            const folderPrefix = folder + '/';
            const prefixLen = folderPrefix.length + 1;
            
            const params = [folderPrefix + '%', folder, folderPrefix + '%', prefixLen];
            if (limit) params.push(limit);
            
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        // Build image URLs with thumbnail paths
        const imageUrls = images.map(img => ({
            url: `/thumbnail/${img.location}/${img.path}`,
            originalUrl: `/photos/${img.location}/${img.path}`,
            rating: img.rating,
            filename: path.basename(img.path)
        }));
        
        res.json({ folder, images: imageUrls });
    } catch (error) {
        console.error('Error getting folder images:', error);
        res.status(500).json({ error: 'Error getting folder images' });
    }
});

// API endpoint to get all images from a folder including subfolders
app.get('/api/folder-images-recursive', async (req, res) => {
    const folder = req.query.folder || '';
    const limit = req.query.limit ? parseInt(req.query.limit) : null;
    
    if (!folder) {
        return res.status(400).json({ error: 'Folder parameter required' });
    }
    
    try {
        const images = await new Promise((resolve, reject) => {
            const query = `
                SELECT path, location,
                    CASE location
                        WHEN 'sorted/5' THEN 5
                        WHEN 'sorted/4' THEN 4
                        WHEN 'sorted/3' THEN 3
                        WHEN 'sorted/2' THEN 2
                        WHEN 'sorted/1' THEN 1
                        ELSE 0
                    END as rating
                FROM photos
                WHERE location LIKE 'sorted/%' 
                    AND path LIKE ?
                ORDER BY rating DESC, path ASC
                ${limit ? 'LIMIT ?' : ''}
            `;
            
            const folderPrefix = folder + '/';
            const params = [folderPrefix + '%'];
            if (limit) params.push(limit);
            
            db.all(query, params, (err, rows) => {
                if (err) reject(err);
                else resolve(rows || []);
            });
        });
        
        // Build image URLs with thumbnail paths
        const imageUrls = images.map(img => ({
            url: `/thumbnail/${img.location}/${img.path}`,
            originalUrl: `/photos/${img.location}/${img.path}`,
            rating: img.rating,
            filename: path.basename(img.path),
            path: img.path,
            location: img.location
        }));
        
        res.json({ folder, images: imageUrls });
    } catch (error) {
        console.error('Error getting folder images recursive:', error);
        res.status(500).json({ error: 'Error getting folder images' });
    }
});

// API endpoint to get original image URL
app.get('/api/original-image', async (req, res) => {
    const folder = req.query.folder || '';
    const filename = req.query.filename || '';
    
    if (!folder || !filename) {
        return res.status(400).json({ error: 'Folder and filename parameters required' });
    }
    
    try {
        // Find the image in the database to get its location
        const image = await new Promise((resolve, reject) => {
            const query = `
                SELECT location, path
                FROM photos
                WHERE location LIKE 'sorted/%' 
                    AND path LIKE ?
                    AND path LIKE ?
            `;
            
            const folderPrefix = folder + '/';
            db.get(query, [folderPrefix + '%', '%' + filename], (err, row) => {
                if (err) reject(err);
                else resolve(row);
            });
        });
        
        if (!image) {
            return res.status(404).json({ error: 'Image not found' });
        }
        
        // Return the original image URL
        res.json({
            url: `/photos/${image.location}/${image.path}`,
            filename: path.basename(image.path)
        });
    } catch (error) {
        console.error('Error getting original image:', error);
        res.status(500).json({ error: 'Error getting original image' });
    }
});

// Check if a folder has direct images (not in subfolders)
app.get('/api/folder-has-images', async (req, res) => {
    const folder = req.query.folder || '';
    
    if (!folder) {
        return res.status(400).json({ error: 'Folder parameter required' });
    }
    
    try {
        const hasImages = await new Promise((resolve, reject) => {
            const query = `
                SELECT COUNT(*) as count
                FROM photos
                WHERE location LIKE 'sorted/%' 
                    AND path LIKE ?
                    AND instr(substr(path, ?), '/') = 0
                LIMIT 1
            `;
            
            const folderPrefix = folder + '/';
            const prefixLen = folderPrefix.length + 1;
            
            db.get(query, [folderPrefix + '%', prefixLen], (err, row) => {
                if (err) reject(err);
                else resolve(row && row.count > 0);
            });
        });
        
        res.json({ folder, hasImages });
    } catch (error) {
        console.error('Error checking folder images:', error);
        res.status(500).json({ error: 'Error checking folder images' });
    }
});

// Serve the folder ratings page
app.get('/folders', (req, res) => {
    res.sendFile(path.join(__dirname, 'folders.html'));
});

// Add an endpoint to download folder rankings as CSV
app.get('/download-folder-rankings', async (req, res) => {
    try {
        // Get folder ranks data
        const sortedFolders = await getFolderRanksData();
        
        // Create CSV content
        let csvContent = 'Folder,Depth,AverageRank,SortedPhotos,UnsortedPhotos,TotalPhotos,Rank5,Rank4,Rank3,Rank2,Rank1\n';
        
        // Add data for each folder
        sortedFolders.forEach(folder => {
            const folderPath = folder.folderPath.replace(/,/g, '_'); // Replace commas to avoid CSV issues
            const depth = folder.depth || folderPath.split('/').length;
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
            csvContent += `${folderPath},${depth},${averageRank},${sortedPhotos},${unsortedPhotos},${totalPhotos},${rank5},${rank4},${rank3},${rank2},${rank1}\n`;
        });
        
        // Set headers for CSV download
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=folder_rankings.csv');
        
        // Send the CSV content
        res.send(csvContent);
    } catch (error) {
        console.error('Error downloading folder rankings:', error);
        res.status(500).send('Error downloading folder rankings');
    }
});
