const photoElement1 = document.getElementById('photo-1');
const photoElement2 = document.getElementById('photo-2');
let activePhotoElement = photoElement1;
let inactivePhotoElement = photoElement2;
const photoWrapper = document.getElementById('photo-wrapper');
const dislikeButton = document.getElementById('dislike');
const likeButton = document.getElementById('like');

let currentPhoto = '';
let currentDirectory = '';
let isProcessing = false;

// Preloaded photo cache
let preloadedPhotos = [];
const MAX_PRELOADED = 5; // Keep up to 5 photos preloaded

// Get the photo name element
const photoNameElement = document.getElementById('photo-name');

// Get the loading spinner element
const loadingSpinner = document.getElementById('loading-spinner');

// Function to show loading spinner and disable controls
function showLoadingSpinner() {
    loadingSpinner.classList.remove('hidden');
    loadingSpinner.classList.add('visible');
    photoNameElement.textContent = '';
    disableRankingControls();
    disableHoverZones();
}

// Function to hide loading spinner and enable controls
function hideLoadingSpinner() {
    loadingSpinner.classList.remove('visible');
    loadingSpinner.classList.add('hidden');
    enableRankingControls();
    enableHoverZones();
}

// Function to disable ranking controls
function disableRankingControls() {
    dislikeButton.disabled = true;
    likeButton.disabled = true;
}

// Function to enable ranking controls
function enableRankingControls() {
    dislikeButton.disabled = false;
    likeButton.disabled = false;
}

// Function to disable hover zones
function disableHoverZones() {
    const hoverZones = document.querySelectorAll('.hover-zone');
    hoverZones.forEach(zone => {
        zone.style.pointerEvents = 'none';
    });
}

// Function to enable hover zones
function enableHoverZones() {
    const hoverZones = document.querySelectorAll('.hover-zone');
    hoverZones.forEach(zone => {
        zone.style.pointerEvents = 'auto';
    });
}

// Function to get the photo name (path excluding ranking and file name)
function getPhotoName(directory, photo) {
    let fullPath = directory ? directory + '/' + photo : photo;
    let parts = fullPath.split('/');
    // Remove the last part (file name)
    parts.pop();
    // If the first part is 'sorted' and the second is a number, remove the second
    if (parts.length >= 2 && parts[0] === 'sorted' && /^\d+$/.test(parts[1])) {
        parts.splice(1, 1);
    }
    return parts.join('/');
}

// Pinch zoom variables
let currentScale = 1;
let initialScale = 1;
let lastTouchDistance = 0;
let isPinching = false;
let startX = 0;
let startY = 0;
let lastX = 0;
let lastY = 0;
let translateX = 0;
let translateY = 0;
let isZoomed = false;
let doubleTapTimer = null;
let lastTap = 0;

// Store pinch center coordinates
let pinchCenterX = 0;
let pinchCenterY = 0;

// Store the initial translation before a pinch starts
let initialTranslateX = 0;
let initialTranslateY = 0;

// Hover effect timeout variables
let hoverTimeout = null;
const HOVER_TIMEOUT_DURATION = 3000; // 3 seconds

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
                
                // Check if this photo is the same as the currently displayed photo
                if (data.photo === currentPhoto && data.directory === currentDirectory) {
                    console.log('Fetched photo is the same as current photo, re-fetching...');
                    // Re-fetch a different photo by calling preloadNextPhoto again
                    setTimeout(preloadNextPhoto, 100);
                    return;
                }
                
                // Check if this photo is already in the preloaded queue
                const isDuplicate = preloadedPhotos.some(p => 
                    p.photo === data.photo && p.directory === data.directory
                );
                if (isDuplicate) {
                    console.log('Fetched photo is already in preload queue, re-fetching...');
                    setTimeout(preloadNextPhoto, 100);
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
                    loaded: false, // Will be set to true when loaded
                    decoded: false // Will be set to true when decoded
                };
                
                // Add to preloaded photos array before loading starts
                preloadedPhotos.push(preloadedPhoto);
                
                console.log('Starting to preload photo:', photoPath);
                
                // Set up load event handler before setting src
                img.onload = () => {
                    console.log('Preloaded photo loaded:', photoPath);
                    preloadedPhoto.loaded = true;
                    
                    // Schedule decoding in the background to avoid blocking UI
                    setTimeout(() => {
                        img.decode().then(() => {
                            console.log('Preloaded photo fully decoded:', photoPath);
                            preloadedPhoto.decoded = true;
                            
                            // If we still need more photos, keep preloading
                            if (preloadedPhotos.length < MAX_PRELOADED) {
                                setTimeout(preloadNextPhoto, 100);
                            }
                        }).catch(error => {
                            // Handle decoding errors - remove problematic photo from cache
                            if (error.name === 'EncodingError' || error.message.includes('cannot be decoded')) {
                                console.warn('Removing corrupted photo from preload cache:', photoPath);
                                const index = preloadedPhotos.indexOf(preloadedPhoto);
                                if (index !== -1) {
                                    preloadedPhotos.splice(index, 1);
                                }
                            } else {
                                console.error('Error decoding preloaded photo:', photoPath, error);
                            }
                            
                            // If we still need more photos, keep preloading
                            if (preloadedPhotos.length < MAX_PRELOADED) {
                                setTimeout(preloadNextPhoto, 100);
                            }
                        });
                    }, 0); // Schedule for next event loop cycle
                };
                
                img.onerror = () => {
                    console.warn('Failed to load preloaded photo (possibly corrupted):', photoPath);
                    
                    // Remove this photo from the preloaded array if it was added
                    const index = preloadedPhotos.indexOf(preloadedPhoto);
                    if (index !== -1) {
                        preloadedPhotos.splice(index, 1);
                    }
                    
                    // Try preloading another photo
                    setTimeout(preloadNextPhoto, 500);
                };
                
                // Start loading the image (this also serves as validation)
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

function displayNextPhoto() {
    if (preloadedPhotos.length > 0) {
        // First, check if we have any fully decoded images
        let decodedIndex = preloadedPhotos.findIndex(photo => photo.decoded);
        
        // If no decoded images, use the first loaded image
        if (decodedIndex === -1) {
            decodedIndex = preloadedPhotos.findIndex(photo => photo.loaded);
        }
        
        // If still no loaded images, just use the first one
        if (decodedIndex === -1) {
            decodedIndex = 0;
        }
        
        // Get the best available photo
        const nextPhoto = preloadedPhotos.splice(decodedIndex, 1)[0];
        currentPhoto = nextPhoto.photo;
        currentDirectory = nextPhoto.directory;
        
        // Hide loading spinner since we have a photo to display
        hideLoadingSpinner();
        
        // Set up load event handler to update photo name when image finishes rendering
        const updatePhotoName = () => {
            const photoName = getPhotoName(currentDirectory, currentPhoto);
            photoNameElement.textContent = photoName;
            console.log('Updated photo name to:', photoName);
        };
        
        // Function to actually show the new photo when it's ready
        const showNewPhoto = (useInstant = false) => {
            // Add instant class if requested to bypass transitions
            if (useInstant) {
                inactivePhotoElement.classList.add('instant');
            } else {
                inactivePhotoElement.classList.remove('instant');
            }
            
            // Swap active and inactive elements
            activePhotoElement.classList.remove('active');
            inactivePhotoElement.classList.add('active');
            
            // Swap the references
            const temp = activePhotoElement;
            activePhotoElement = inactivePhotoElement;
            inactivePhotoElement = temp;
            
            // Clear the old photo from the now-inactive element to prevent it from showing
            inactivePhotoElement.src = '';
            
            // Remove instant class from the now-inactive element
            inactivePhotoElement.classList.remove('instant');
            
            // Update the photo name
            updatePhotoName();
        };
        
        // Clear the inactive element first to prevent old photo from showing
        inactivePhotoElement.src = '';
        
        // If we have a decoded image, use it directly
        if (nextPhoto.decoded && nextPhoto.img) {
            // Set the new photo src on the inactive element first
            inactivePhotoElement.src = nextPhoto.img.src;
            // Show the new photo immediately since it's already decoded
            showNewPhoto(true); // Use instant display for preloaded photos
        } else {
            // Set the new photo src on the inactive element and wait for it to load
            inactivePhotoElement.onload = showNewPhoto;
            inactivePhotoElement.src = nextPhoto.path;
        }
        
        // Preload the next photo after displaying the current one
        preloadNextPhoto();
    } else {
        // No preloaded photos available, show loading spinner
        showLoadingSpinner();
        // Try to load a random photo
        loadRandomPhoto();
    }
}

function loadRandomPhoto() {
    if (isProcessing) return;
    isProcessing = true;
    
    // If we have a preloaded photo, use it
    if (preloadedPhotos.length > 0) {
        // First, check if we have any fully decoded images
        let decodedIndex = preloadedPhotos.findIndex(photo => photo.decoded);
        
        // If no decoded images, use the first loaded image
        if (decodedIndex === -1) {
            decodedIndex = preloadedPhotos.findIndex(photo => photo.loaded);
        }
        
        // If still no loaded images, just use the first one
        if (decodedIndex === -1) {
            decodedIndex = 0;
        }
        
        // Get the best available photo
        const preloadedPhoto = preloadedPhotos.splice(decodedIndex, 1)[0];
        
        // Update current photo info
        currentPhoto = preloadedPhoto.photo;
        currentDirectory = preloadedPhoto.directory;
        
        // Hide loading spinner since we have a photo to display
        hideLoadingSpinner();
        
        // Set up load event handler to update photo name when image finishes rendering
        const updatePhotoName = () => {
            const photoName = getPhotoName(currentDirectory, currentPhoto);
            photoNameElement.textContent = photoName;
            console.log('Updated photo name to:', photoName);
        };
        
        // Function to actually show the new photo when it's ready
        const showNewPhoto = (useInstant = false) => {
            // Add instant class if requested to bypass transitions
            if (useInstant) {
                inactivePhotoElement.classList.add('instant');
            } else {
                inactivePhotoElement.classList.remove('instant');
            }
            
            // Swap active and inactive elements
            activePhotoElement.classList.remove('active');
            inactivePhotoElement.classList.add('active');
            
            // Swap the references
            const temp = activePhotoElement;
            activePhotoElement = inactivePhotoElement;
            inactivePhotoElement = temp;
            
            // Clear the old photo from the now-inactive element to prevent it from showing
            inactivePhotoElement.src = '';
            
            // Remove instant class from the now-inactive element
            inactivePhotoElement.classList.remove('instant');
            
            // Update the photo name
            updatePhotoName();
        };
        
        // Clear the inactive element first to prevent old photo from showing
        inactivePhotoElement.src = '';
        
        // If we have a decoded image, use it directly
        if (preloadedPhoto.decoded && preloadedPhoto.img) {
            // Set the new photo src on the inactive element first
            inactivePhotoElement.src = preloadedPhoto.img.src;
            // Show the new photo immediately since it's already decoded
            showNewPhoto(true); // Use instant display for preloaded photos
        } else {
            // Set the new photo src on the inactive element and wait for it to load
            inactivePhotoElement.onload = showNewPhoto;
            inactivePhotoElement.src = preloadedPhoto.path;
        }
        
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
                
                // Hide loading spinner since we received photo data
                hideLoadingSpinner();
                
                // Handle case where directory is empty (base directory)
                const photoPath = currentDirectory ? `/photos/${currentDirectory}/${currentPhoto}` : `/photos/${currentPhoto}`;
                console.log('Loading photo directly:', photoPath);
                
                // Create a new image and decode it before displaying
                const img = new Image();
                
                // Set up load event handler
                img.onload = () => {
                    console.log('Direct loaded photo:', photoPath);
                    
                    // Display the photo immediately without waiting for decode
                    // Clear the inactive element first to prevent old photo from showing
                    inactivePhotoElement.src = '';
                    
                    // Set the new photo src on the inactive element first
                    inactivePhotoElement.src = img.src;
                    
                    // Now swap and show the new photo
                    // Swap active and inactive elements
                    activePhotoElement.classList.remove('active');
                    inactivePhotoElement.classList.add('active');
                    
                    // Swap the references
                    const temp = activePhotoElement;
                    activePhotoElement = inactivePhotoElement;
                    inactivePhotoElement = temp;
                    
                    // Clear the old photo from the now-inactive element to prevent it from showing
                    inactivePhotoElement.src = '';
                    
                    // Update the photo name display after image is rendered
                    const photoName = getPhotoName(currentDirectory, currentPhoto);
                    photoNameElement.textContent = photoName;
                    console.log('Updated photo name to:', photoName);
                    
                    isProcessing = false;
                    
                    // Decode in the background to improve future performance
                    setTimeout(() => {
                        img.decode().then(() => {
                            console.log('Direct loaded photo decoded in background');
                        }).catch(error => {
                            // Handle decoding errors gracefully
                            if (error.name === 'EncodingError' || error.message.includes('cannot be decoded')) {
                                console.warn('Direct loaded photo has decoding issues (will still display):', photoPath);
                            } else {
                                console.error('Error decoding direct loaded photo in background:', error);
                            }
                        });
                    }, 0);
                    
                    // Start preloading photos for next time
                    preloadNextPhoto();
                };
                
                img.onerror = () => {
                    console.error('Error loading direct photo:', photoPath);
                    activePhotoElement.alt = 'No photos available';
                    isProcessing = false;
                    
                    // Keep loading spinner visible since no photo loaded
                    // Don't hide it here - let the user see we're still trying
                    
                    // Try preloading anyway
                    preloadNextPhoto();
                };
                
                // Start loading the image
                img.src = photoPath;
            })
            .catch(error => {
                console.error('Error loading photo:', error);
                activePhotoElement.alt = 'No photos available';
                isProcessing = false;
                
                // Keep loading spinner visible since no photo could be loaded
                // Don't hide it here - let the user see we're still trying
            });
    }
}

function showFloatingEmoji(action, clickX = null, rating = null) {
    const photoRect = activePhotoElement.getBoundingClientRect();
    const emoji = document.createElement('div');
    
    if (action === 'rate' && rating !== null) {
        // For rating actions, show the number
        emoji.className = 'floating-emoji up';
        emoji.textContent = `${rating}⭐`;
        emoji.style.left = (photoRect.left + photoRect.width / 2 - 30) + 'px';
    } else {
        // Traditional like/dislike
        emoji.className = `floating-emoji ${action === 'like' ? 'up' : 'down'}`;
        emoji.textContent = action === 'like' ? '👍🏼' : '👎🏼';
        
        // Position on the sides
        if (action === 'like') {
            emoji.style.left = (photoRect.right - 100) + 'px';
        } else {
            emoji.style.left = (photoRect.left + 100) + 'px';
        }
    }
    
    emoji.style.top = (photoRect.top + photoRect.height / 2) + 'px';
    
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

// Helper function to yield to the main thread using scheduler.yield() if available,
// or setTimeout as a fallback
async function yieldToMain() {
    if (typeof scheduler !== 'undefined' && typeof scheduler.yield === 'function') {
        return scheduler.yield();
    }
    
    return new Promise(resolve => {
        setTimeout(resolve, 0);
    });
}

async function handlePhotoAction(action, rating = null) {
    if (!currentPhoto) return;
    
    // Save the current photo info for the background request
    const photoToAction = currentPhoto;
    const directoryToAction = currentDirectory;
    
    // Send the action for the CURRENT photo before displaying the next one
    // This ensures we're rating the photo that's currently visible
    let endpoint;
    let requestBody;
    
    if (rating !== null) {
        // Direct rating (1-5)
        endpoint = '/rate';
        requestBody = { 
            photo: photoToAction,
            directory: directoryToAction,
            rating: rating
        };
    } else {
        // Traditional like/dislike
        endpoint = action === 'like' ? '/like' : '/dislike';
        requestBody = { 
            photo: photoToAction,
            directory: directoryToAction
        };
    }
    
    try {
        // Start the fetch request but don't await it yet
        const fetchPromise = fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
        });
        
        // Now display the next photo immediately for better UI responsiveness
        // This happens while the fetch is in progress
        displayNextPhoto();
        
        // Yield to the main thread to allow UI updates to complete
        await yieldToMain();
        
        // Now await the fetch result
        const response = await fetchPromise;
        
        if (!response.ok) {
            throw new Error(`Error ${action}ing photo`);
        }
        console.log(`Successfully ${action}d photo:`, photoToAction);
    } catch (error) {
        console.error('Error with background action:', error);
    } finally {
        // Request completed - no action needed
        console.log(`${action} request completed for photo:`, photoToAction);
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
    // Don't allow keyboard shortcuts when controls are disabled
    if (dislikeButton.disabled || likeButton.disabled) {
        return;
    }
    
    if (event.key === 'ArrowLeft') {
        showFloatingEmoji('dislike');
        handlePhotoAction('dislike');
    } else if (event.key === 'ArrowRight') {
        showFloatingEmoji('like');
        handlePhotoAction('like');
    } else if (event.key >= '1' && event.key <= '5') {
        // Direct rating with number keys 1-5
        const rating = parseInt(event.key);
        showFloatingEmoji('rate', rating);
        handlePhotoAction('rate', rating);
    }
});



// Hide instructions after 4 seconds
const instructions = document.querySelector('.instructions');
if (instructions) {
    setTimeout(() => {
        instructions.classList.add('hidden');
    }, 4000);
}

// Setup pinch-zoom functionality
function setupPinchZoom() {
    // Reset zoom when a new photo is loaded
    photoElement1.addEventListener('load', resetZoom);
    photoElement2.addEventListener('load', resetZoom);
    
    // Handle touch events for pinch-zoom
    photoWrapper.addEventListener('touchstart', handleTouchStart, { passive: false });
    photoWrapper.addEventListener('touchmove', handleTouchMove, { passive: false });
    photoWrapper.addEventListener('touchend', handleTouchEnd, { passive: false });
    
    // Double-tap to zoom
    photoWrapper.addEventListener('click', handleDoubleTap);
    
    // Reset zoom when window is resized
    window.addEventListener('resize', resetZoom);
}

function resetZoom() {
    // Reset all zoom-related variables
    currentScale = 1;
    translateX = 0;
    translateY = 0;
    initialTranslateX = 0;
    initialTranslateY = 0;
    isZoomed = false;
    isPinching = false;
    updatePhotoTransform();
    
    console.log('Zoom reset');
}

function handleDoubleTap(e) {
    const now = Date.now();
    const timeDiff = now - lastTap;
    
    if (timeDiff < 300 && timeDiff > 0) {
        // Double tap detected
        e.preventDefault();
        
        if (isZoomed) {
            resetZoom();
        } else {
            // Zoom in to 2.5x at the tap position
            currentScale = 2.5;
            isZoomed = true;
            
            // Calculate tap position relative to image
            const rect = activePhotoElement.getBoundingClientRect();
            const tapX = e.clientX - rect.left;
            const tapY = e.clientY - rect.top;
            
            // Calculate relative position (0-1) within the image
            const relativeX = tapX / rect.width;
            const relativeY = tapY / rect.height;
            
            // Center the zoom on the tap position
            // This formula ensures the tapped point stays in the same position after zooming
            translateX = (0.5 - relativeX) * rect.width / currentScale;
            translateY = (0.5 - relativeY) * rect.height / currentScale;
            
            // Apply constraints to keep image within view
            applyConstraints();
            
            updatePhotoTransform();
        }
    }
    
    lastTap = now;
}

function handleTouchStart(e) {
    if (e.touches.length === 2) {
        // Two finger touch - pinch zoom
        e.preventDefault();
        isPinching = true;
        
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        
        // Calculate initial distance between the two touch points
        lastTouchDistance = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
        );
        
        // Store the center point between the two fingers
        pinchCenterX = (touch1.clientX + touch2.clientX) / 2;
        pinchCenterY = (touch1.clientY + touch2.clientY) / 2;
        
        // Store the initial scale and translation values
        initialScale = currentScale;
        initialTranslateX = translateX;
        initialTranslateY = translateY;
        
        // Get the position of the pinch center relative to the image
        const rect = activePhotoElement.getBoundingClientRect();
        
        // Log debug info
        console.log('Pinch start:', {
            pinchCenter: { x: pinchCenterX, y: pinchCenterY },
            imageRect: { left: rect.left, top: rect.top, width: rect.width, height: rect.height },
            initialScale,
            initialTranslate: { x: initialTranslateX, y: initialTranslateY }
        });
    } else if (e.touches.length === 1 && isZoomed) {
        // One finger touch while zoomed - panning
        e.preventDefault();
        const touch = e.touches[0];
        lastX = touch.clientX;
        lastY = touch.clientY;
    }
}

function handleTouchMove(e) {
    if (isPinching && e.touches.length === 2) {
        // Handle pinch zoom
        e.preventDefault();
        
        const touch1 = e.touches[0];
        const touch2 = e.touches[1];
        
        // Calculate new distance between fingers
        const currentTouchDistance = Math.hypot(
            touch2.clientX - touch1.clientX,
            touch2.clientY - touch1.clientY
        );
        
        // Get the current center point between fingers
        const currentCenterX = (touch1.clientX + touch2.clientX) / 2;
        const currentCenterY = (touch1.clientY + touch2.clientY) / 2;
        
        // Calculate how much the center point has moved
        const centerDeltaX = currentCenterX - pinchCenterX;
        const centerDeltaY = currentCenterY - pinchCenterY;
        
        // Calculate the new scale based on finger distance change
        const newScale = Math.min(Math.max(initialScale * (currentTouchDistance / lastTouchDistance), 1), 5);
        
        // Get image dimensions
        const rect = activePhotoElement.getBoundingClientRect();
        
        // Convert pinch center to image space coordinates (relative to image center)
        const imageCenterX = rect.left + rect.width / 2;
        const imageCenterY = rect.top + rect.height / 2;
        
        // Calculate pinch center relative to image center
        const pinchToCenterX = pinchCenterX - imageCenterX;
        const pinchToCenterY = pinchCenterY - imageCenterY;
        
        // Calculate how the translation should change to keep the pinch center fixed
        // This is the key formula that ensures the point under your fingers stays fixed
        const newTranslateX = initialTranslateX + 
                            // Account for center point movement
                            centerDeltaX / newScale + 
                            // Account for the scaling effect at the pinch point
                            pinchToCenterX * (1/initialScale - 1/newScale);
                            
        const newTranslateY = initialTranslateY + 
                            centerDeltaY / newScale + 
                            pinchToCenterY * (1/initialScale - 1/newScale);
        
        // Update the current scale and translation
        currentScale = newScale;
        translateX = newTranslateX;
        translateY = newTranslateY;
        
        // Update zoom state
        isZoomed = currentScale > 1.05;
        
        // If not zoomed, reset translation
        if (!isZoomed) {
            translateX = 0;
            translateY = 0;
        }
        
        // Apply constraints to keep image within view
        applyConstraints();
        
        // Update the transform
        updatePhotoTransform();
        
        // Debug info
        console.log('Pinch move:', {
            scale: currentScale,
            translate: { x: translateX, y: translateY },
            center: { x: currentCenterX, y: currentCenterY },
            centerDelta: { x: centerDeltaX, y: centerDeltaY }
        });
    } else if (e.touches.length === 1 && isZoomed) {
        // Handle panning when zoomed
        e.preventDefault();
        
        const touch = e.touches[0];
        const deltaX = touch.clientX - lastX;
        const deltaY = touch.clientY - lastY;
        
        // Update translation - divide by scale to make panning feel consistent at all zoom levels
        translateX += deltaX / currentScale;
        translateY += deltaY / currentScale;
        
        // Apply constraints to keep image within view
        applyConstraints();
        
        lastX = touch.clientX;
        lastY = touch.clientY;
        
        updatePhotoTransform();
    }
}

// Apply constraints to keep the image within view
function applyConstraints() {
    const rect = photoElement.getBoundingClientRect();
    const containerRect = photoWrapper.getBoundingClientRect();
    
    // For landscape images (width > height)
    if (rect.width > rect.height) {
        // Calculate the maximum allowed translation to keep image edges visible
        const maxTranslateX = (rect.width * (currentScale - 1)) / (2 * currentScale);
        const maxTranslateY = (rect.height * (currentScale - 1)) / (2 * currentScale);
        
        // Apply constraints
        translateX = Math.min(Math.max(translateX, -maxTranslateX), maxTranslateX);
        translateY = Math.min(Math.max(translateY, -maxTranslateY), maxTranslateY);
    } 
    // For portrait images (height > width)
    else {
        // Calculate the maximum allowed translation to keep image edges visible
        const maxTranslateX = (rect.width * (currentScale - 1)) / (2 * currentScale);
        const maxTranslateY = (rect.height * (currentScale - 1)) / (2 * currentScale);
        
        // Apply constraints
        translateX = Math.min(Math.max(translateX, -maxTranslateX), maxTranslateX);
        translateY = Math.min(Math.max(translateY, -maxTranslateY), maxTranslateY);
    }
}

function handleTouchEnd(e) {
    if (isPinching) {
        isPinching = false;
        
        // If scale is close to 1, snap back to 1
        if (currentScale < 1.05) {
            resetZoom();
        }
    }
    
    // Prevent default click handling if we're zoomed in
    if (isZoomed && e.touches.length === 0) {
        e.preventDefault();
    }
}

function updatePhotoTransform() {
    // Apply the transform to the image element
    activePhotoElement.style.transform = `scale(${currentScale}) translate(${translateX}px, ${translateY}px)`;
    
    // Always keep the photo wrapper overflow hidden to prevent scrolling
    photoWrapper.style.overflow = 'hidden';
    
    // Debug info in UI
    const debugInfo = document.getElementById('debug-info');
    if (debugInfo) {
        debugInfo.textContent = `Scale: ${currentScale.toFixed(2)}, Translate: (${translateX.toFixed(1)}, ${translateY.toFixed(1)})`;
    }
}

// Modify the click handler to only work when not zoomed and controls are enabled
document.addEventListener('click', (event) => {
    // Skip if we're zoomed in
    if (isZoomed) return;
    
    // Skip if controls are disabled (loading state)
    if (dislikeButton.disabled || likeButton.disabled) {
        return;
    }
    
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

// Handle refresh cache button click
const refreshCacheBtn = document.getElementById('refresh-cache');
if (refreshCacheBtn) {
    refreshCacheBtn.addEventListener('click', () => {
        refreshCacheBtn.disabled = true;
        refreshCacheBtn.textContent = 'Refreshing...';
        
        // Call the refresh-cache endpoint
        fetch('/refresh-cache')
            .then(response => response.json())
            .then(data => {
                console.log('Cache refreshed:', data);
                refreshCacheBtn.textContent = 'Refresh Rankings';
                refreshCacheBtn.disabled = false;
                
                // Show a notification
                const notification = document.createElement('div');
                notification.className = 'notification';
                notification.textContent = `Rankings refreshed! Found ${data.basePhotos} unsorted photos and ${data.sortedPhotos} sorted photos.`;
                document.body.appendChild(notification);
                
                // Remove notification after 3 seconds
                setTimeout(() => {
                    notification.classList.add('fade-out');
                    setTimeout(() => {
                        document.body.removeChild(notification);
                    }, 500);
                }, 3000);
            })
            .catch(error => {
                console.error('Error refreshing cache:', error);
                refreshCacheBtn.textContent = 'Refresh Failed';
                setTimeout(() => {
                    refreshCacheBtn.textContent = 'Refresh Rankings';
                    refreshCacheBtn.disabled = false;
                }, 2000);
            });
    });
}

// Initial load
loadRandomPhoto();

// Initialize pinch-zoom
setupPinchZoom();

// Setup hover effect timeout when mouse leaves browser or enters middle zone
function setupHoverEffectTimeout() {
    const leftHoverZone = document.querySelector('.hover-zone.left');
    const rightHoverZone = document.querySelector('.hover-zone.right');
    const photoContainer = document.querySelector('.photo-container');
    
    // Function to remove all hover effect classes
    function removeAllHoverEffects() {
        if (leftHoverZone) {
            leftHoverZone.classList.remove('hover-active');
        }
        if (rightHoverZone) {
            rightHoverZone.classList.remove('hover-active');
        }
    }
    
    // Function to remove hover effect for a specific zone
    function removeHoverEffect(zone) {
        if (zone) {
            zone.classList.remove('hover-active');
        }
    }
    
    // Start timeout to clear hover effects
    function startHoverTimeout() {
        // Clear any existing timeout
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
        }
        
        // Set a new timeout to remove hover effects after 3 seconds
        hoverTimeout = setTimeout(() => {
            removeAllHoverEffects();
        }, HOVER_TIMEOUT_DURATION);
    }
    
    // When mouse leaves the window/document
    document.addEventListener('mouseleave', () => {
        startHoverTimeout();
    });
    
    // When mouse enters the window/document, clear the timeout
    document.addEventListener('mouseenter', () => {
        if (hoverTimeout) {
            clearTimeout(hoverTimeout);
            hoverTimeout = null;
        }
    });
    
    // Add mouseenter event to left hover zone
    if (leftHoverZone) {
        leftHoverZone.addEventListener('mouseenter', () => {
            // Remove hover effect from right zone first
            removeHoverEffect(rightHoverZone);
            // Add hover effect to left zone
            leftHoverZone.classList.add('hover-active');
        });
        
        // When mouse leaves left zone, remove its hover effect
        leftHoverZone.addEventListener('mouseleave', () => {
            removeHoverEffect(leftHoverZone);
        });
    }
    
    // Add mouseenter event to right hover zone
    if (rightHoverZone) {
        rightHoverZone.addEventListener('mouseenter', () => {
            // Remove hover effect from left zone first
            removeHoverEffect(leftHoverZone);
            // Add hover effect to right zone
            rightHoverZone.classList.add('hover-active');
        });
        
        // When mouse leaves right zone, remove its hover effect
        rightHoverZone.addEventListener('mouseleave', () => {
            removeHoverEffect(rightHoverZone);
        });
    }
    
    // Handle middle zone (the area between left and right zones)
    // We'll detect this by checking when the mouse is over the photo container
    // but not over any of the hover zones
    if (photoContainer) {
        photoContainer.addEventListener('mousemove', (event) => {
            // Check if the mouse is over any hover zone
            const isOverLeftZone = event.target === leftHoverZone || event.target.closest('.hover-zone.left');
            const isOverRightZone = event.target === rightHoverZone || event.target.closest('.hover-zone.right');
            
            // If not over any hover zone, we're in the middle zone
            if (!isOverLeftZone && !isOverRightZone) {
                // Start the timeout to clear hover effects
                startHoverTimeout();
            }
        });
    }
}

// Initialize hover effect timeout
setupHoverEffectTimeout();

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

// Initialize the app - load the first photo
console.log('Initializing Photo Sorter app...');
// Show loading spinner initially until first photo is loaded
showLoadingSpinner();
// Load the first photo
loadRandomPhoto();
