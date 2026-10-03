/// <reference types="vite/client" />

declare module '*.html?raw' {
  const documentMarkup: string;
  export default documentMarkup;
}