// A simple toggleable (on/off) logger with levels for debugging

export class Logger {
  static NONE = 0;
  static ERROR = 1;
  static WARN = 2;
  static INFO = 3;
  static DEBUG = 4;

  static level = Logger.INFO;

  static print(message: any, log_level: number) {
    if (log_level && log_level <= Logger.level) {
      console.log(message);
    }
  }

  static debug(message: any) {
    Logger.print(message, Logger.DEBUG);
  }

  static info(message: any) {
    Logger.print(message, Logger.INFO);
  }

  static warn(message: any) {
    Logger.print(message, Logger.WARN);
  }

  static error(message: any) {
    Logger.print(message, Logger.ERROR);
  }

  static setLevel(value: any) {
    Logger.level = value;
  }
}
