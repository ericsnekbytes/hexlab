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

class HexEditorWidget extends Widget {
  /**
  * TODO: Add docsxy
  */

  rootContainer: HTMLElement;
  hexContent: HTMLElement;
  clearHexButton: HTMLElement;

  constructor() {
    super();

    this.addClass('hexlab_root_widget');

    // Build layout elements
    this.rootContainer = document.createElement('div');
    this.rootContainer.classList.add('hexlab_root_container')
    console.log('BBB1')
    console.log(this.rootContainer)
    this.node.appendChild(this.rootContainer);

    this.hexContent = document.createElement('div');
    this.hexContent.classList.add('hexlab_hexContent')
    console.log(this.hexContent)
    this.hexContent.innerText = 'STARTy3'
    this.rootContainer.appendChild(this.hexContent)

    this.clearHexButton = document.createElement('div');
    this.clearHexButton.classList.add('hexlab_clearHexButton')
    console.log(this.clearHexButton)
    this.clearHexButton.innerText = 'CLEAR_btn'
    this.clearHexButton.addEventListener('click', this.clearHex.bind(this), {passive: true})
    this.rootContainer.appendChild(this.clearHexButton)
  }

  clearHex() {
    console.log('AAA2')
    console.log(this.hexContent)
    console.log(this.hexContent.classList.contains('hexlab_hexContent'))
    this.hexContent.innerText = ''
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
