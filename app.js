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

function handlePhotoAction(action) {
    if (!currentPhoto || isProcessing) return;
    isProcessing = true;
    
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

likeButton.addEventListener('click', () => handlePhotoAction('like'));
dislikeButton.addEventListener('click', () => handlePhotoAction('dislike'));

// Add keyboard controls
document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
        dislikeButton.click();
    } else if (event.key === 'ArrowRight') {
        likeButton.click();
    }
});


// Initial load
loadRandomPhoto();
