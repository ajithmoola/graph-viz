const vscode = require('vscode');
const path = require('path');

function getHtml(webview, scriptUri) {
  const csp = webview.cspSource;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy"
      content="default-src 'none'; script-src ${csp}; style-src ${csp} 'unsafe-inline'; img-src ${csp} data:;">
<style>
  html, body { margin: 0; padding: 0; width: 100%; height: 100%; overflow: hidden; }
  #canvas { display: block; width: 100%; height: 100%; }
  #tooltip {
    position: absolute; display: none; pointer-events: none;
    background: var(--vscode-editorHoverWidget-background, #252526);
    color: var(--vscode-editorHoverWidget-foreground, #ccc);
    border: 1px solid var(--vscode-editorHoverWidget-border, #454545);
    font-family: var(--vscode-editor-font-family, monospace);
    font-size: 12px; padding: 6px 8px; border-radius: 3px;
    white-space: pre; z-index: 10; max-width: 400px; overflow: hidden;
  }
  #status {
    position: absolute; left: 8px; bottom: 6px; pointer-events: none;
    color: var(--vscode-descriptionForeground, #999);
    font-family: var(--vscode-font-family, sans-serif); font-size: 11px;
  }
  #error {
    position: absolute; top: 40%; width: 100%; text-align: center; display: none;
    color: var(--vscode-errorForeground, #f48771);
    font-family: var(--vscode-font-family, sans-serif); font-size: 13px;
  }
</style>
</head>
<body>
<canvas id="canvas"></canvas>
<div id="tooltip"></div>
<div id="status"></div>
<div id="error"></div>
<script src="${scriptUri}"></script>
</body>
</html>`;
}

function activate(context) {
  const provider = {
    async openCustomDocument(uri) {
      return { uri, dispose() {} };
    },

    async resolveCustomEditor(document, panel) {
      panel.webview.options = {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')],
      };
      const scriptUri = panel.webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, 'dist', 'webview.js')
      );
      panel.webview.html = getHtml(panel.webview, scriptUri);

      const send = async () => {
        try {
          const bytes = await vscode.workspace.fs.readFile(document.uri);
          const data = JSON.parse(Buffer.from(bytes).toString('utf8'));
          panel.webview.postMessage({ type: 'graph', data });
        } catch (e) {
          panel.webview.postMessage({ type: 'error', message: String(e) });
        }
      };

      const msgSub = panel.webview.onDidReceiveMessage((m) => {
        if (m && m.type === 'ready') send();
      });

      const dir = vscode.Uri.joinPath(document.uri, '..');
      const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(dir, path.basename(document.uri.path))
      );
      watcher.onDidChange(() => send());
      watcher.onDidCreate(() => send());

      panel.onDidDispose(() => {
        msgSub.dispose();
        watcher.dispose();
      });
    },
  };

  context.subscriptions.push(
    vscode.window.registerCustomEditorProvider('nxGraphViewer.view', provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate };
