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
  hexContent: HTMLElement;
  openButton: HTMLElement;

  constructor() {
    super();

    this.addClass('hexlab_root_widget');

    // Build layout elements
    this.rootContainer = document.createElement('div');
    this.rootContainer.classList.add('hexlab_root_container');
    console.log('BBB1');
    console.log(this.rootContainer);
    this.node.appendChild(this.rootContainer);

    this.openButton = document.createElement('div');
    this.openButton.classList.add('hexlab_open_button');
    this.openButton.innerText = 'Load File';
    this.openButton.addEventListener('click', this.openFile.bind(this), {passive: true});
    this.rootContainer.appendChild(this.openButton);

    this.hexContent = document.createElement('div');
    this.hexContent.classList.add('hexlab_hex_content');
    console.log(this.hexContent);
    this.hexContent.innerText = 'STARTy3';
    this.rootContainer.appendChild(this.hexContent);
  }

  async openFile() {
    console.log('[HexLab] Opening Filxe');

//    let [fileHandle] = await window.showOpenFilePicker();
//    const fileData = await fileHandle.getFile();
//    let binRaw = await fileData.arrayBuffer();
//    let binData = new Uint8Array(binRaw);
//
//    let byteItems = [];
//    let count = 0;
//    for (const byte of binData) {
//      console.log('xBYTE');
//      console.log(byte);
//      let b = document.createElement('div');
//      b.classList.add('hexlab_hex_digit');
//      byteItems.push(b);
//      let left_hex = 240 & byte >> 4;
//      let right_hex = 15 & byte;
//      console.log('LEFT');
//      console.log(left_hex);
//      console.log('RIGHT');
//      console.log(right_hex);
//      console.log('####');
//
//      b.innerText = byte.toString();
//      count += 1;
//      if (count > 64) {
//        break;
//      }
//      this.hexContent.appendChild(b);
//    }
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
