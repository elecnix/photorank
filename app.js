const photoElement = document.getElementById('photo');
const dislikeButton = document.getElementById('dislike');
const likeButton = document.getElementById('like');

let currentPhoto = '';
let currentDirectory = '';
let isProcessing = false;
let nextPhoto = null;
let nextDirectory = null;

// Preload the next photo
function preloadNextPhoto() {
    fetch('/random-photo')
        .then(response => response.json())
        .then(data => {
            // Create a new image element to preload the next photo
            const img = new Image();
            const photoPath = `/photos/${data.directory}/${data.photo}`;
            console.log('Preloading photo:', photoPath);
            img.src = photoPath;
            nextPhoto = data.photo;
            nextDirectory = data.directory;
        })
        .catch(error => {
            console.error('Error preloading next photo:', error);
        });
}

function loadRandomPhoto() {
    if (isProcessing) return;
    isProcessing = true;
    
    // If we have a preloaded photo, use it
    if (nextPhoto && nextDirectory) {
        currentPhoto = nextPhoto;
        currentDirectory = nextDirectory;
        const photoPath = `/photos/${currentDirectory}/${currentPhoto}`;
        console.log('Loading preloaded photo:', photoPath);
        photoElement.src = photoPath;
        nextPhoto = null;
        nextDirectory = null;
        isProcessing = false;
        
        // Start preloading the next photo
        preloadNextPhoto();
    } else {
        // If no preloaded photo, load one directly
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
                const photoPath = `/photos/${currentDirectory}/${currentPhoto}`;
                console.log('Loading photo:', photoPath);
                photoElement.src = photoPath;
                isProcessing = false;
                
                // Start preloading the next photo
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

// Try to request fullscreen on mobile
function requestFullscreen() {
    if (document.documentElement.requestFullscreen) {
        document.documentElement.requestFullscreen();
    } else if (document.documentElement.webkitRequestFullscreen) {
        document.documentElement.webkitRequestFullscreen();
    }
}

function handlePhotoAction(action) {
    if (!currentPhoto || isProcessing) return;
    isProcessing = true;
    
    // Request fullscreen on first interaction
    requestFullscreen();
    
    // Save the current photo info for the background request
    const photoToAction = currentPhoto;
    const directoryToAction = currentDirectory;
    
    // If we have a preloaded photo, show it immediately
    if (nextPhoto && nextDirectory) {
        currentPhoto = nextPhoto;
        currentDirectory = nextDirectory;
        const photoPath = `/photos/${currentDirectory}/${currentPhoto}`;
        console.log('Loading preloaded photo:', photoPath);
        photoElement.src = photoPath;
        nextPhoto = null;
        nextDirectory = null;
        
        // Start preloading the next photo
        preloadNextPhoto();
    } else {
        // Otherwise load a new photo immediately
        fetch('/random-photo')
            .then(response => response.json())
            .then(data => {
                currentPhoto = data.photo;
                currentDirectory = data.directory;
                const photoPath = `/photos/${currentDirectory}/${currentPhoto}`;
                console.log('Loading new photo:', photoPath);
                photoElement.src = photoPath;
                
                // Start preloading the next photo
                preloadNextPhoto();
            })
            .catch(error => {
                console.error('Error loading next photo:', error);
            });
    }
    
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
    })
    .catch(error => {
        console.error('Error with background action:', error);
    });
    
    isProcessing = false;
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

// Add click handling for the photo
photoElement.addEventListener('click', (event) => {
    // Get click position relative to the photo element
    const rect = photoElement.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const thirdWidth = rect.width / 3;

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
