// A simple toggleable (on/off) logger with levels for debugging

export class Logger {
  static NONE = 0;
  static ERROR = 1;
  static WARN = 2;
  static INFO = 3;
  static DEBUG = 4;

  static level = Logger.INFO;

  static _print(...messages: any) {
    console.log(...messages);
  }

  static print(messages: any, log_level: number) {
    if (log_level && log_level <= Logger.level) {
      Logger._print(...messages);
    }
  }

  static debug(...messages: any) {
    Logger.print(messages, Logger.DEBUG);
  }

  static info(...messages: any) {
    Logger.print(messages, Logger.INFO);
  }

  static warn(...messages: any) {
    Logger.print(messages, Logger.WARN);
  }

  static error(...messages: any) {
    Logger.print(messages, Logger.ERROR);
  }

  static setLevel(value: any) {
    Logger.level = value;
  }
}
