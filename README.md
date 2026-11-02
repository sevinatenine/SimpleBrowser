# Simple Browser

Simple Browser is a from-scratch, minimalistic web browser written in NodeJS. It uses the tessera.js library for making windows and drawing pixels, and uses parse5 to parse the HTML. It renders HTML and a very few select CSS properties. Most web pages do not look correct, but it does render them decently. 

## Running

You can either run it using the NPM package or run it locally on your machine with NodeJS.

### NPM

Run it with:

```bash
npx simplebrowser-js
```

### Locally

First, you need to clone this repository from GitHub:

```bash
git clone https://github.com/sevinatenine/SimpleBrowser
```

To run the code:

```bash
node src/launcher.js
```

> **NOTE:** I wrote a launcher file that will load the correct library or shared object for raylib, which tessera uses, because there were problems. The windows one should not need to load a special library, but a MacOS arm64 and a Linux x64 dylib/so are included.