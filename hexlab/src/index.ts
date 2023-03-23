import {
  ILayoutRestorer,
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

import {
  ICommandPalette,
  MainAreaWidget,
  WidgetTracker
} from '@jupyterlab/apputils';

import { Widget } from '@lumino/widgets';

declare global {
    interface Window {
        showOpenFilePicker:any;
    }
}

class HexEditorWidget extends Widget {
  /**
  * TODO: Add docsxy
  */

  rootContainer: HTMLElement;
  hexGridArea: HTMLElement;
  hexContent: HTMLElement;
  openButton: HTMLElement;

  currentBlobData: Uint8Array | null;
  currentFilename: string | null;

  constructor() {
    super();

    // Initialize data members
    this.currentFilename = null;
    this.currentBlobData = null;

    // Add styling and build layout tree
    this.addClass('hexlab_root_widget');

    // Build layout subtree
    // ....................
    // Add a root element into the jupyter-widget (full hex UI fits in here)
    this.rootContainer = document.createElement('div');
    this.rootContainer.classList.add('hexlab_root_container');
    this.node.appendChild(this.rootContainer);

    // Set up some controls at the top of the layout
    this.openButton = document.createElement('div');
    this.openButton.classList.add('hexlab_open_button');
    this.openButton.innerText = 'Load File';
    this.openButton.addEventListener('click', this.openFile.bind(this), {passive: true});
    this.rootContainer.appendChild(this.openButton);

    // Define a container for the hex area
    this.hexGridArea = document.createElement('div');
    this.hexGridArea.classList.add('hexlab_hex_grid_area');
    this.rootContainer.appendChild(this.hexGridArea);

    // Define a grid with slots to hold byte content
    this.hexContent = document.createElement('div');
    this.hexContent.classList.add('hexlab_hex_content');
    this.hexContent.classList.add('--jp-code-font-family');
    this.hexContent.classList.add('--jp-code-font-size');
    console.log(this.hexContent);
    this.hexGridArea.appendChild(this.hexContent);
  }

  async openFile() {
    console.log('[HexLab] Opening File');

    // Clear/empty current hex grid
    this.hexContent.innerText = '';

    // Clear stored filename and attempt to re-populate
    this.currentFilename = null;
    try {
      let [fileHandle] = await window.showOpenFilePicker();
      const fileData = await fileHandle.getFile();
      let binRaw = await fileData.arrayBuffer();
      let binData = new Uint8Array(binRaw);

      // Populate binary data members for this file
      this.currentFilename = fileHandle.name;
      this.currentBlobData = binData;

      console.log('[Hexlab] File opened successfully');
    } catch (err) {
      if (err.code && err.code == DOMException.ABORT_ERR) {
        console.log('[Hexlab] File open was aborted');
      } else {
        console.log('[Hexlab] Error opening file');
      }
    } finally {
      if (this.currentFilename == null) {
        console.log('[Hexlab] File open failed');
        return;
      }
    }

    // Get/populate hex representations for bin data
    let byteItems = [];
    let count = 0;
    for (const byte of this.currentBlobData!) {
      console.log('BYTE');
      console.log(byte);
      let b = document.createElement('span');
      b.setAttribute('display', 'inline');
      b.classList.add('hexlab_hex_byte');
      byteItems.push(b);
      let left_hex = byte >> 4;
      let right_hex = 15 & byte;
      console.log('LEFT');
      console.log(left_hex);
      console.log('RIGHT');
      console.log(right_hex);
      console.log('####');
      let charmap: any = {
        0: '0',
        1: '1',
        2: '2',
        3: '3',
        4: '4',
        5: '5',
        6: '6',
        7: '7',
        8: '8',
        9: '9',
        10: 'a',
        11: 'b',
        12: 'c',
        13: 'd',
        14: 'e',
        15: 'f',
      };

      // Combine hex digits into a byte
      let hex_value = charmap[left_hex].toString() + charmap[right_hex].toString()

      // Populate the byte element and add it to the layout
      b.innerText = hex_value;
      count += 1;
      if (count > 2048) {
        break;
      }
      this.hexContent.appendChild(b);
    }
  }

  configureGrid() {
    () => {};
  }

  setHex() {
    this.hexContent.innerText = 'ABCdef!'
  }
}

/**
* Activate the hexlab widget extension.
*/
function activate(app: JupyterFrontEnd, palette: ICommandPalette, restorer: ILayoutRestorer | null) {
  console.log('JupyterLab extension hexlab is activated!');

  // Declare a widget variable
  let widget: MainAreaWidget<HexEditorWidget>;

  // Add an application command
  const command: string = 'hexlab:open';
  app.commands.addCommand(command, {
    label: 'Hex Editor',
    execute: () => {
      if (!widget || widget.isDisposed) {
        const content = new HexEditorWidget();
        widget = new MainAreaWidget({content});
        widget.id = 'hexlab';
        widget.title.label = 'Hex Editor';
        widget.title.closable = true;
      }
      if (!tracker.has(widget)) {
        // Track the state of the widget for later restoration
        tracker.add(widget);
      }
      if (!widget.isAttached) {
        // Attach the widget to the main work area if it's not there
        app.shell.add(widget, 'main');
      }

      // Activate the widget
      app.shell.activateById(widget.id);
    }
  });

  // Add the command to the palette.
  palette.addItem({ command, category: 'Tutorial' });

  // Track and restore the widget state
  let tracker = new WidgetTracker<MainAreaWidget<HexEditorWidget>>({
    namespace: 'hexlab'
  });
  if (restorer) {
    restorer.restore(tracker, {
      command,
      name: () => 'hexlab'
    });
  }
}

/**
 * Initialization data for the hexlab extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'hexlab:plugin',
  autoStart: true,
  requires: [ICommandPalette],
  optional: [ILayoutRestorer],
  activate: activate,
};

export default plugin;
