const photoElement = document.getElementById('photo');
const dislikeButton = document.getElementById('dislike');
const likeButton = document.getElementById('like');

let currentPhoto = '';
let currentDirectory = '';

function loadRandomPhoto() {
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
            photoElement.src = `${currentDirectory}/${currentPhoto}`;
        })
        .catch(error => {
            console.error('Error loading photo:', error);
            photoElement.alt = 'No photos available';
        });
}

likeButton.addEventListener('click', () => {
    if (!currentPhoto) return;
    
    fetch('/like', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            photo: currentPhoto,
            directory: currentDirectory
        }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Error liking photo');
        }
        loadRandomPhoto();
    })
    .catch(error => {
        console.error('Error:', error);
    });
});

dislikeButton.addEventListener('click', () => {
    if (!currentPhoto) return;
    
    fetch('/dislike', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
            photo: currentPhoto,
            directory: currentDirectory
        }),
    })
    .then(response => {
        if (!response.ok) {
            throw new Error('Error disliking photo');
        }
        loadRandomPhoto();
    })
    .catch(error => {
        console.error('Error:', error);
    });
});

// Add keyboard controls
document.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') {
        dislikeButton.click();
    } else if (event.key === 'ArrowRight') {
        likeButton.click();
    }
});

// Load a random photo when the page loads
loadRandomPhoto();
