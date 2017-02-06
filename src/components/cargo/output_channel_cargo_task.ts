import { ChildProcess, spawn } from 'child_process';

import kill = require('tree-kill');

import * as readline from 'readline';

import { ExtensionContext, OutputChannel, StatusBarItem, commands, window } from 'vscode';

import elegantSpinner = require('elegant-spinner');

import { ConfigurationManager } from '../configuration/configuration_manager';

import { DiagnosticParser } from './diagnostic_parser';

import { DiagnosticPublisher } from './diagnostic_publisher';

class CargoTaskStatusBarManager {
    private stopStatusBarItem: StatusBarItem;

    private spinnerStatusBarItem: StatusBarItem;

    private runningTask: CargoTask | undefined;

    private interval: NodeJS.Timer | undefined;

    public constructor(context: ExtensionContext) {
        const commandName = 'rust.CargoTaskStatusBarManager.stopRunningTask';

        this.stopStatusBarItem = window.createStatusBarItem();
        this.stopStatusBarItem.command = commandName;
        this.stopStatusBarItem.text = 'Stop';
        this.stopStatusBarItem.tooltip = 'Click to stop running cargo task';

        this.spinnerStatusBarItem = window.createStatusBarItem();
        this.spinnerStatusBarItem.tooltip = 'Cargo task is running';

        this.runningTask = undefined;

        this.interval = undefined;

        context.subscriptions.push(
            commands.registerCommand(commandName, () => {
                if (this.runningTask) {
                    this.runningTask.kill();
                }
            })
        );
    }

    public setRunningTask(runningTask: CargoTask | undefined): void {
        this.runningTask = runningTask;
    }

    public show(): void {
        this.stopStatusBarItem.show();

        this.spinnerStatusBarItem.show();

        const spinner = elegantSpinner();

        const update = () => {
            this.spinnerStatusBarItem.text = spinner();
        };

        this.interval = setInterval(update, 100);
    }

    public hide(): void {
        clearInterval(this.interval);

        this.interval = null;

        this.stopStatusBarItem.hide();

        this.spinnerStatusBarItem.hide();
    }
}

type ExitCode = number;

class CargoTask {
    private configurationManager: ConfigurationManager;

    private process: ChildProcess | null;

    private interrupted: boolean;

    public constructor(configurationManager: ConfigurationManager) {
        this.configurationManager = configurationManager;

        this.process = null;

        this.interrupted = false;
    }

    public execute(
        command: string,
        args: string[],
        cwd: string,
        onStart?: () => void,
        onStdoutLine?: (data: string) => void,
        onStderrLine?: (data: string) => void
    ): Promise<ExitCode> {
        return new Promise<ExitCode>((resolve, reject) => {
            const cargoPath = this.configurationManager.getCargoPath();

            if (onStart) {
                onStart();
            }

            let newEnv = Object.assign({}, process.env);

            const customEnv = this.configurationManager.getCargoEnv();

            if (customEnv) {
                newEnv = Object.assign(newEnv, customEnv);
            }

            // Prepend a command before arguments
            args = [command].concat(args);

            this.process = spawn(cargoPath, args, { cwd, env: newEnv });

            const stdout = readline.createInterface({ input: this.process.stdout });

            stdout.on('line', line => {
                if (!onStdoutLine) {
                    return;
                }

                onStdoutLine(line);
            });

            const stderr = readline.createInterface({ input: this.process.stderr });

            stderr.on('line', line => {
                if (!onStderrLine) {
                    return;
                }

                onStderrLine(line);
            });

            this.process.on('error', error => {
                reject(error);
            });

            this.process.on('exit', code => {
                this.process.removeAllListeners();
                this.process = null;

                if (this.interrupted) {
                    reject();

                    return;
                }

                resolve(code);
            });
        });
    }

    public kill(): Thenable<any> {
        return new Promise(resolve => {
            if (!this.interrupted && this.process) {
                kill(this.process.pid, 'SIGTERM', resolve);

                this.interrupted = true;
            }
        });
    }
}

class ChannelWrapper {
    private channel: OutputChannel;

    constructor(channel: OutputChannel) {
        this.channel = channel;
    }

    public append(message: string): void {
        this.channel.append(message);
    }

    public clear(): void {
        this.channel.clear();
    }

    public show(): void {
        this.channel.show(true);
    }
}

export class OutputChannelCargoTask {
    private configurationManager: ConfigurationManager;

    private cargoTaskStatusBarManager: CargoTaskStatusBarManager;

    private diagnosticParser: DiagnosticParser;

    private diagnosticPublisher: DiagnosticPublisher;

    private channel: ChannelWrapper;

    public constructor(context: ExtensionContext, configurationManager: ConfigurationManager) {
        this.configurationManager = configurationManager;

        this.cargoTaskStatusBarManager = new CargoTaskStatusBarManager(context);

        this.diagnosticParser = new DiagnosticParser();

        this.diagnosticPublisher = new DiagnosticPublisher();

        this.channel = new ChannelWrapper(window.createOutputChannel('Cargo'));
    }

    public async execute(command: string, args: string[], cwd: string): Promise<void> {
        switch (command) {
            case 'build':
            case 'check':
            case 'clippy':
            case 'run':
            case 'test':
                args = ['--message-format', 'json'].concat(args);
                break;
            default:
                break;
        }

        this.diagnosticPublisher.clearDiagnostics();

        const runningTask = new CargoTask(this.configurationManager);

        this.cargoTaskStatusBarManager.setRunningTask(runningTask);

        if (this.configurationManager.shouldShowRunningCargoTaskOutputChannel()) {
            this.channel.show();
        }

        this.cargoTaskStatusBarManager.show();

        let startTime: number;

        const onStart = () => {
            startTime = Date.now();

            this.channel.clear();
            this.channel.append(`Started cargo ${command} ${args.join(' ')}\n`);
        };

        const onStdoutLine = (line: string) => {
            if (line.startsWith('{')) {
                const fileDiagnostics = this.diagnosticParser.parseLine(line);

                for (const fileDiagnostic of fileDiagnostics) {
                    this.diagnosticPublisher.publishDiagnostic(fileDiagnostic, cwd);
                }
            } else {
                this.channel.append(`${line}\n`);
            }
        };

        const onStderrLine = (line: string) => {
            this.channel.append(`${line}\n`);
        };

        let exitCode;

        try {
            exitCode =
                await runningTask.execute(command, args, cwd, onStart, onStdoutLine, onStderrLine);
        } catch (error) {
            this.cargoTaskStatusBarManager.hide();

            this.cargoTaskStatusBarManager.setRunningTask(undefined);

            // No error means the task has been interrupted
            if (!error) {
                return;
            }

            if (error.message !== 'ENOENT') {
                return;
            }

            window.showInformationMessage('The "cargo" command is not available. Make sure it is installed.');
        }

        this.cargoTaskStatusBarManager.hide();

        this.cargoTaskStatusBarManager.setRunningTask(undefined);

        const endTime = Date.now();

        this.channel.append(`Completed with code ${exitCode}\n`);
        this.channel.append(`It took approximately ${(endTime - startTime) / 1000} seconds\n`);
    }
}
