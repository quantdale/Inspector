// Minimal ambient browser globals used only inside page.evaluate callbacks,
// which run in the browser context but are type-checked in the Node build.
declare const document: any;
declare const localStorage: any;
declare const window: any;
