# PhotoRank

## Overview

Rank a collection of photos by randomly rating them in a web interface.

## Docker Deployment

### Prerequisites
- Docker installed
- Docker Hub account (optional, for pushing/pulling images)

### Building the Docker Image
```bash
docker build -t elecnix/photorank:latest .
```

### Running the Docker Image
```bash
docker run -p 3000:3000 -v /path/to/your/photos:/app/photos elecnix/photorank:latest
```

## Contributing
Pull requests are welcome. For major changes, please open an issue first.

## License

[MIT](https://choosealicense.com/licenses/mit/)
