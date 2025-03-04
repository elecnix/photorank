const photoElement = document.getElementById('photo');
const dislikeButton = document.getElementById('dislike');
const likeButton = document.getElementById('like');

let currentPhoto = '';
let currentDirectory = '';
let isProcessing = false;

// Preloaded photo cache
let preloadedPhotos = [];
const MAX_PRELOADED = 3; // Keep up to 3 photos preloaded

// Preload the next photo
function preloadNextPhoto() {
    // Only preload if we don't have enough preloaded photos
    if (preloadedPhotos.length < MAX_PRELOADED) {
        console.log(`Preloading next photo (${preloadedPhotos.length}/${MAX_PRELOADED})...`);
        
        // Fetch a random photo from the server
        fetch('/random-photo')
            .then(response => {
                if (!response.ok) {
                    throw new Error('Failed to fetch random photo');
                }
                return response.json();
            })
            .then(data => {
                if (!data || !data.photo) {
                    console.error('No photo data received from server');
                    return;
                }
                
                // Create a new image element to preload the next photo
                const img = new Image();
                
                // Handle case where directory is empty (base directory)
                const photoPath = data.directory ? `/photos/${data.directory}/${data.photo}` : `/photos/${data.photo}`;
                
                // Create the preloaded photo object
                const preloadedPhoto = {
                    photo: data.photo,
                    directory: data.directory,
                    path: photoPath,
                    img: img,
                    loaded: false // Will be set to true when loaded
                };
                
                console.log('Starting to preload photo:', photoPath);
                
                // Set up load event handler before setting src
                img.onload = () => {
                    console.log('Preloaded photo loaded successfully:', photoPath);
                    preloadedPhoto.loaded = true;
                    
                    // If we still need more photos, keep preloading
                    if (preloadedPhotos.length < MAX_PRELOADED) {
                        setTimeout(preloadNextPhoto, 100);
                    }
                };
                
                img.onerror = () => {
                    console.error('Failed to load preloaded photo:', photoPath);
                    
                    // Remove this photo from the preloaded array if it was added
                    const index = preloadedPhotos.indexOf(preloadedPhoto);
                    if (index !== -1) {
                        preloadedPhotos.splice(index, 1);
                    }
                    
                    // Try preloading again
                    setTimeout(preloadNextPhoto, 500);
                };
                
                // Add to preloaded photos array before loading starts
                preloadedPhotos.push(preloadedPhoto);
                
                // Start loading the image
                img.src = photoPath;
            })
            .catch(error => {
                console.error('Error preloading next photo:', error);
                // Try preloading again after a delay
                setTimeout(preloadNextPhoto, 1000);
            });
    } else {
        console.log(`Already have ${preloadedPhotos.length} preloaded photos ready`);
    }
}

function loadRandomPhoto() {
    if (isProcessing) return;
    isProcessing = true;
    
    // If we have a preloaded photo, use it
    if (preloadedPhotos.length > 0) {
        // Get the first preloaded photo
        const preloadedPhoto = preloadedPhotos.shift();
        
        // Update current photo info
        currentPhoto = preloadedPhoto.photo;
        currentDirectory = preloadedPhoto.directory;
        
        console.log('Loading preloaded photo:', preloadedPhoto.path, 'Loaded status:', preloadedPhoto.loaded);
        photoElement.src = preloadedPhoto.path;
        isProcessing = false;
        
        // Start preloading the next photo to maintain our cache
        setTimeout(preloadNextPhoto, 100);
    } else {
        // If no preloaded photo, load one directly
        console.log('No preloaded photos available, fetching directly...');
        fetch('/random-photo')
            .then(response => {
                if (!response.ok) {
                    throw new Error('No photos available');
                }
                return response.json();
            })
            .then(data => {
                currentPhoto = data.photo;
                currentDirectory = data.directory;
                // Handle case where directory is empty (base directory)
                const photoPath = currentDirectory ? `/photos/${currentDirectory}/${currentPhoto}` : `/photos/${currentPhoto}`;
                console.log('Loading photo directly:', photoPath);
                photoElement.src = photoPath;
                isProcessing = false;
                
                // Start preloading photos for next time
                preloadNextPhoto();
            })
            .catch(error => {
                console.error('Error loading photo:', error);
                photoElement.alt = 'No photos available';
                isProcessing = false;
            });
    }
}

function showFloatingEmoji(action, clickX) {
    const photoRect = photoElement.getBoundingClientRect();
    const emoji = document.createElement('div');
    emoji.className = `floating-emoji ${action === 'like' ? 'up' : 'down'}`;
    emoji.textContent = action === 'like' ? '👍🏼' : '👎🏼';
    emoji.style.top = (photoRect.top + photoRect.height / 2) + 'px';
    
    // Position on the sides
    if (action === 'like') {
        emoji.style.left = (photoRect.right - 100) + 'px';
    } else {
        emoji.style.left = (photoRect.left + 100) + 'px';
    }
    
    document.body.appendChild(emoji);
    
    // Remove the element after animation
    emoji.addEventListener('animationend', () => {
        document.body.removeChild(emoji);
    });
}

// Toggle fullscreen
function toggleFullscreen() {
    if (!document.fullscreenElement && !document.webkitFullscreenElement) {
        // Enter fullscreen
        if (document.documentElement.requestFullscreen) {
            document.documentElement.requestFullscreen();
        } else if (document.documentElement.webkitRequestFullscreen) {
            document.documentElement.webkitRequestFullscreen();
        }
    } else {
        // Exit fullscreen
        if (document.exitFullscreen) {
            document.exitFullscreen();
        } else if (document.webkitExitFullscreen) {
            document.webkitExitFullscreen();
        }
    }
}

// Update fullscreen button icon
function updateFullscreenButton() {
    const fullscreenBtn = document.getElementById('fullscreen');
    if (!fullscreenBtn) return;
    
    if (document.fullscreenElement || document.webkitFullscreenElement) {
        fullscreenBtn.textContent = '⤡'; // Fullscreen exit icon
    } else {
        fullscreenBtn.textContent = '⤢'; // Fullscreen enter icon
    }
}

// Add fullscreen button handler
const fullscreenBtn = document.getElementById('fullscreen');
if (fullscreenBtn) {
    fullscreenBtn.addEventListener('click', (event) => {
        event.stopPropagation();
        toggleFullscreen();
    });
}

// Listen for fullscreen changes
document.addEventListener('fullscreenchange', updateFullscreenButton);
document.addEventListener('webkitfullscreenchange', updateFullscreenButton);

function handlePhotoAction(action) {
    if (!currentPhoto || isProcessing) return;
    isProcessing = true;
    
    // Save the current photo info for the background request
    const photoToAction = currentPhoto;
    const directoryToAction = currentDirectory;
    
    // Log the current state of preloaded photos before taking action
    console.log(`Current preloaded photos before ${action}:`, 
                preloadedPhotos.map(p => ({ path: p.path, loaded: p.loaded })));
    
    // Send the like/dislike action in the background
    const endpoint = action === 'like' ? '/like' : '/dislike';
    fetch(endpoint, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            photo: photoToAction,
            directory: directoryToAction
        }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error(`Error ${action}ing photo`);
        }
        console.log(`Successfully ${action}d photo:`, photoToAction);
    })
    .catch(error => {
        console.error('Error with background action:', error);
    });
    
        // Display next photo immediately from preloaded cache
    if (preloadedPhotos.length > 0) {
        // Make sure we're using a fully loaded preloaded photo
        const preloadedPhoto = preloadedPhotos.shift();
        
        // Debug info
        console.log('Using preloaded photo after ranking:', preloadedPhoto.path, 'Loaded status:', preloadedPhoto.loaded);
        
        // Update current photo info
        currentPhoto = preloadedPhoto.photo;
        currentDirectory = preloadedPhoto.directory;
        
        // Set the image source - use the already loaded image
        photoElement.src = preloadedPhoto.path;
        
        // We can set isProcessing to false immediately
        isProcessing = false;
        
        // Start preloading another photo to maintain our cache
        setTimeout(preloadNextPhoto, 100);
    } else {
        // No preloaded photo available, load a new one
        console.log('No preloaded photos available after ranking, fetching new photo...');
        fetch('/random-photo')
            .then(response => {
                if (!response.ok) {
                    throw new Error('No photos available');
                }
                return response.json();
            })
            .then(data => {
                currentPhoto = data.photo;
                currentDirectory = data.directory;
                // Handle case where directory is empty (base directory)
                const photoPath = currentDirectory ? `/photos/${currentDirectory}/${currentPhoto}` : `/photos/${currentPhoto}`;
                console.log('Loading new photo after ranking:', photoPath);
                photoElement.src = photoPath;
                
                // Set isProcessing to false
                isProcessing = false;
                
                // Start preloading photos for next time
                setTimeout(preloadNextPhoto, 100);
            })
            .catch(error => {
                console.error('Error loading next photo after ranking:', error);
                isProcessing = false;
            });
    }
}

likeButton.addEventListener('click', (event) => {
    event.stopPropagation(); // Prevent photo click handler from firing
    showFloatingEmoji('like');
    handlePhotoAction('like');
});

dislikeButton.addEventListener('click', (event) => {
    event.stopPropagation(); // Prevent photo click handler from firing
    showFloatingEmoji('dislike');
    handlePhotoAction('dislike');
});

// Add keyboard controls
document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
        showFloatingEmoji('dislike');
        handlePhotoAction('dislike');
    } else if (event.key === 'ArrowRight') {
        showFloatingEmoji('like');
        handlePhotoAction('like');
    }
});

// Add click handling for the entire viewport
document.addEventListener('click', (event) => {
    // Ignore clicks on buttons
    if (event.target.closest('.buttons')) {
        return;
    }
    
    const thirdWidth = window.innerWidth / 3;
    const x = event.clientX;

    if (x < thirdWidth) {
        // Left third = dislike
        showFloatingEmoji('dislike');
        handlePhotoAction('dislike');
    } else if (x > thirdWidth * 2) {
        // Right third = like
        showFloatingEmoji('like');
        handlePhotoAction('like');
    } else {
        // Center third = show instructions
        const instructions = document.querySelector('.instructions');
        if (instructions) {
            instructions.classList.remove('hidden');
            // Hide again after 4 seconds
            setTimeout(() => {
                instructions.classList.add('hidden');
            }, 4000);
        }
    }
});

// Hide instructions after 4 seconds
const instructions = document.querySelector('.instructions');
if (instructions) {
    setTimeout(() => {
        instructions.classList.add('hidden');
    }, 4000);
}

// Initial load
loadRandomPhoto();

// Ensure we always have preloaded photos ready
setTimeout(() => {
    console.log('Ensuring preloaded photos are available...');
    // Start preloading photos
    for (let i = 0; i < MAX_PRELOADED; i++) {
        if (preloadedPhotos.length < MAX_PRELOADED) {
            setTimeout(() => preloadNextPhoto(), i * 200); // Stagger the preloads
        }
    }
}, 1000);

// Periodically check and refresh preloaded photos if needed
setInterval(() => {
    // Log the current state of the preloaded photos
    console.log('Current preloaded photos:', 
                preloadedPhotos.map(p => ({ path: p.path, loaded: p.loaded })));
    
    // Ensure we have enough preloaded photos
    if (preloadedPhotos.length < MAX_PRELOADED) {
        console.log('Refreshing preloaded photos cache...');
        preloadNextPhoto();
    }
    
    // Remove any unloaded photos that have been in the cache too long
    const now = Date.now();
    preloadedPhotos = preloadedPhotos.filter(p => p.loaded || !p.timestamp || now - p.timestamp < 10000);
}, 3000);
