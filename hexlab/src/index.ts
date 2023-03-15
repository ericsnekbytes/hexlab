import {
  JupyterFrontEnd,
  JupyterFrontEndPlugin
} from '@jupyterlab/application';

/**
 * Initialization data for the hexlab extension.
 */
const plugin: JupyterFrontEndPlugin<void> = {
  id: 'hexlab:plugin',
  autoStart: true,
  activate: (app: JupyterFrontEnd) => {
    console.log('JupyterLab extension hexlab is activated!');
  }
};

export default plugin;
