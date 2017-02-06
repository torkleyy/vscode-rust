import * as vscode from 'vscode';

import * as tmp from 'tmp';

import { ExtensionContext } from 'vscode';

import { ConfigurationManager } from '../configuration/configuration_manager';

import { CurrentWorkingDirectoryManager } from '../configuration/current_working_directory_manager';

import { ChildLogger } from '../logging/child_logger';

import { CustomConfigurationChooser } from './custom_configuration_chooser';

import { DiagnosticParser } from './diagnostic_parser';

import { DiagnosticPublisher } from './diagnostic_publisher';

import { OutputChannelCargoTask } from './output_channel_cargo_task';

export enum BuildType {
    Debug,
    Release
}

enum CrateType {
    Application,
    Library
}

export enum CheckTarget {
    Library,
    Application
}

class UserDefinedArgs {
    public static getBuildArgs(): string[] {
        const args = UserDefinedArgs.getArgs('buildArgs');

        return args;
    }

    public static getCheckArgs(): string[] {
        const args = UserDefinedArgs.getArgs('checkArgs');

        return args;
    }

    public static getClippyArgs(): string[] {
        const args = UserDefinedArgs.getArgs('clippyArgs');

        return args;
    }

    public static getRunArgs(): string[] {
        const args = UserDefinedArgs.getArgs('runArgs');

        return args;
    }

    public static getTestArgs(): string[] {
        const args = UserDefinedArgs.getArgs('testArgs');

        return args;
    }

    private static getArgs(property: string): string[] {
        const configuration = getConfiguration();
        const args = configuration.get<string[]>(property);

        return args;
    }
}



class CargoTaskManager {
    private configurationManager: ConfigurationManager;

    private currentWorkingDirectoryManager: CurrentWorkingDirectoryManager;

    private outputChannelCargoTask: OutputChannelCargoTask;

    public constructor(
        context: ExtensionContext,
        configurationManager: ConfigurationManager,
        currentWorkingDirectoryManager: CurrentWorkingDirectoryManager
    ) {
        this.configurationManager = configurationManager;

        this.currentWorkingDirectoryManager = currentWorkingDirectoryManager;

        this.outputChannelCargoTask = new OutputChannelCargoTask(context, configurationManager);
    }

    public async invokeCargoInit(crateType: CrateType, name: string, cwd: string): Promise<void> {
        const args = [, '--name', name];

        switch (crateType) {
            case CrateType.Application:
                args.push('--bin');
                break;

            case CrateType.Library:
                args.push('--lib');
                break;

            default:
                throw new Error(`Unhandled crate type=${crateType}`);
        }

        await this.runCargo('init', args, false);

        this.currentTask = new CargoTask(this.configurationManager);

        this.channel.clear();

        {
            const configuration = getConfiguration();

            if (configuration['showOutput']) {
                this.channel.show();
            }
        }

        const onLine = (line: string) => {
            this.channel.append(`${line}\n`);
        };

        const onStart = undefined;

        const onStdoutLine = onLine;

        const onStderrLine = onLine;

        await this.currentTask.execute('init', args, cwd, onStart, onStdoutLine, onStderrLine);

        this.currentTask = null;
    }

    public invokeCargoBuildWithArgs(args: string[]): void {
        this.runCargo('build', args, true);
    }

    public invokeCargoBuildUsingBuildArgs(): void {
        this.invokeCargoBuildWithArgs(UserDefinedArgs.getBuildArgs());
    }

    public async invokeCargoCheckWithArgs(args: string[]): Promise<void> {
        const isAvailable = await this.checkCargoCheckAvailability();

        let command;

        if (isAvailable) {
            command = 'check';
        } else {
            command = 'rustc';

            args.push('--', '-Zno-trans');
        }

        this.runCargo(command, args, true);
    }

    public invokeCargoCheckUsingCheckArgs(): void {
        this.invokeCargoCheckWithArgs(UserDefinedArgs.getCheckArgs());
    }

    public invokeCargoClippyWithArgs(args: string[]): void {
        this.runCargo('clippy', args, true);
    }

    public invokeCargoClippyUsingClippyArgs(): void {
        this.invokeCargoClippyWithArgs(UserDefinedArgs.getClippyArgs());
    }

    public async invokeCargoNew(projectName: string, isBin: boolean, cwd: string): Promise<void> {
        this.currentTask = new CargoTask(this.configurationManager);

        this.channel.clear();

        const args = [projectName, isBin ? '--bin' : '--lib'];

        {
            const configuration = getConfiguration();

            if (configuration['showOutput']) {
                this.channel.show();
            }
        }

        const onLine = (line: string) => {
            this.channel.append(`${line}\n`);
        };

        const onStart = undefined;

        const onStdoutLine = onLine;

        const onStderrLine = onLine;

        await this.currentTask.execute('new', args, cwd, onStart, onStdoutLine, onStderrLine);

        this.currentTask = null;
    }

    public invokeCargoRunWithArgs(args: string[]): void {
        this.runCargo('run', args, true);
    }

    public invokeCargoRunUsingRunArgs(): void {
        this.invokeCargoRunWithArgs(UserDefinedArgs.getRunArgs());
    }

    public invokeCargoTestWithArgs(args: string[]): void {
        this.runCargo('test', args, true);
    }

    public invokeCargoTestUsingTestArgs(): void {
        this.invokeCargoTestWithArgs(UserDefinedArgs.getTestArgs());
    }

    public invokeCargo(command: string, args: string[]): void {
        this.runCargo(command, args, true);
    }

    public stopTask(): void {
        if (this.currentTask) {
            this.currentTask.kill();
        }
    }

    private async checkCargoCheckAvailability(): Promise<boolean> {
        const task = new CargoTask(this.configurationManager);

        const exitCode = await task.execute('check', ['--help'], '/');

        return exitCode === 0;
    }

    private async runCargo(command: string, args: string[], force = false): Promise<void> {
        let cwd;

        try {
            cwd = await this.currentWorkingDirectoryManager.cwd();
        } catch (error) {
            vscode.window.showErrorMessage(error.message);

            return;
        }

        if (force && this.currentTask) {
            await this.currentTask.kill();

            this.runCargo(command, args, force);

            return;
        } else if (this.currentTask) {
            return;
        }

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

        this.currentTask = new CargoTask(this.configurationManager);

        {
            const configuration = getConfiguration();

            if (configuration['showOutput']) {
                this.channel.show();
            }
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
                    if (this.diagnosticPublishingEnabled) {
                        this.diagnosticPublisher.publishDiagnostic(fileDiagnostic, cwd);
                    }
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
            exitCode = await this.currentTask
                .execute(command, args, cwd, onStart, onStdoutLine, onStderrLine);
        } catch (error) {
            this.cargoTaskStatusBarManager.hide();

            this.currentTask = null;

            // No error means the task has been interrupted
            if (!error) {
                return;
            }

            if (error.message !== 'ENOENT') {
                return;
            }

            vscode.window.showInformationMessage('The "cargo" command is not available. Make sure it is installed.');
        }

        this.cargoTaskStatusBarManager.hide();

        this.currentTask = null;

        const endTime = Date.now();

        this.channel.append(`Completed with code ${exitCode}\n`);
        this.channel.append(`It took approximately ${(endTime - startTime) / 1000} seconds\n`);
    }
}

export class CargoManager {
    private cargoManager: CargoTaskManager;

    private customConfigurationChooser: CustomConfigurationChooser;

    private logger: ChildLogger;

    public constructor(
        context: ExtensionContext,
        configurationManager: ConfigurationManager,
        currentWorkingDirectoryManager: CurrentWorkingDirectoryManager,
        logger: ChildLogger
    ) {
        const stopCommandName = 'rust.cargo.terminate';

        this.cargoManager = new CargoTaskManager(
            configurationManager,
            currentWorkingDirectoryManager,
            stopCommandName
        );

        this.customConfigurationChooser = new CustomConfigurationChooser(configurationManager);

        this.logger = logger;

        this.registerCommands(context, stopCommandName);
    }

    public setDiagnosticParsingEnabled(diagnosticParsingEnabled: boolean): void {
        this.cargoManager.setDiagnosticPublishingEnabled(diagnosticParsingEnabled);
    }

    public executeBuildTask(): void {
        this.cargoManager.invokeCargoBuildUsingBuildArgs();
    }

    public executeCheckTask(): void {
        this.cargoManager.invokeCargoCheckUsingCheckArgs();
    }

    public executeClippyTask(): void {
        this.cargoManager.invokeCargoClippyUsingClippyArgs();
    }

    public executeRunTask(): void {
        this.cargoManager.invokeCargoRunUsingRunArgs();
    }

    public executeTestTask(): void {
        this.cargoManager.invokeCargoTestUsingTestArgs();
    }

    private registerCommands(context: ExtensionContext, stopCommandName: string): void {
        // Cargo init
        context.subscriptions.push(this.registerCommandHelpingCreatePlayground('rust.cargo.new.playground'));

        // Cargo new
        context.subscriptions.push(this.registerCommandHelpingCreateProject('rust.cargo.new.bin', true));

        context.subscriptions.push(this.registerCommandHelpingCreateProject('rust.cargo.new.lib', false));

        // Cargo build
        context.subscriptions.push(this.registerCommandInvokingCargoBuildUsingBuildArgs('rust.cargo.build.default'));

        context.subscriptions.push(this.registerCommandHelpingChooseArgsAndInvokingCargoBuild('rust.cargo.build.custom'));

        // Cargo run
        context.subscriptions.push(this.registerCommandInvokingCargoRunUsingRunArgs('rust.cargo.run.default'));

        context.subscriptions.push(this.registerCommandHelpingChooseArgsAndInvokingCargoRun('rust.cargo.run.custom'));

        // Cargo test
        context.subscriptions.push(this.registerCommandInvokingCargoTestUsingTestArgs('rust.cargo.test.default'));

        context.subscriptions.push(this.registerCommandHelpingChooseArgsAndInvokingCargoTest('rust.cargo.test.custom'));

        // Cargo bench
        context.subscriptions.push(this.registerCommandInvokingCargoWithArgs('rust.cargo.bench', 'bench'));

        // Cargo doc
        context.subscriptions.push(this.registerCommandInvokingCargoWithArgs('rust.cargo.doc', 'doc'));

        // Cargo update
        context.subscriptions.push(this.registerCommandInvokingCargoWithArgs('rust.cargo.update', 'update'));

        // Cargo clean
        context.subscriptions.push(this.registerCommandInvokingCargoWithArgs('rust.cargo.clean', 'clean'));

        // Cargo check
        context.subscriptions.push(this.registerCommandInvokingCargoCheckUsingCheckArgs('rust.cargo.check.default'));

        context.subscriptions.push(this.registerCommandHelpingChooseArgsAndInvokingCargoCheck('rust.cargo.check.custom'));

        // Cargo clippy
        context.subscriptions.push(this.registerCommandInvokingCargoClippyUsingClippyArgs('rust.cargo.clippy.default'));

        context.subscriptions.push(this.registerCommandHelpingChooseArgsAndInvokingCargoClippy('rust.cargo.clippy.custom'));

        // Cargo terminate
        context.subscriptions.push(this.registerCommandStoppingCargoTask(stopCommandName));
    }

    public registerCommandHelpingCreatePlayground(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.helpCreatePlayground();
        });
    }

    public registerCommandHelpingChooseArgsAndInvokingCargoCheck(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.customConfigurationChooser.choose('customCheckConfigurations').then(args => {
                this.cargoManager.invokeCargoCheckWithArgs(args);
            }, () => undefined);
        });
    }

    public registerCommandInvokingCargoCheckUsingCheckArgs(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.executeCheckTask();
        });
    }

    public registerCommandHelpingChooseArgsAndInvokingCargoClippy(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.customConfigurationChooser.choose('customClippyConfigurations').then(args => {
                this.cargoManager.invokeCargoClippyWithArgs(args);
            }, () => undefined);
        });
    }

    public registerCommandInvokingCargoClippyUsingClippyArgs(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.executeClippyTask();
        });
    }

    public registerCommandHelpingCreateProject(commandName: string, isBin: boolean): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            const cwd = vscode.workspace.rootPath;

            if (!cwd) {
                vscode.window.showErrorMessage('Current document not in the workspace');

                return;
            }

            const projectType = isBin ? 'executable' : 'library';
            const placeHolder = `Enter ${projectType} project name`;

            vscode.window.showInputBox({ placeHolder: placeHolder }).then((name: string) => {
                if (!name || name.length === 0) {
                    return;
                }

                this.cargoManager.invokeCargoNew(name, isBin, cwd);
            });
        });
    }

    public registerCommandHelpingChooseArgsAndInvokingCargoBuild(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.customConfigurationChooser.choose('customBuildConfigurations').then(args => {
                this.cargoManager.invokeCargoBuildWithArgs(args);
            }, () => undefined);
        });
    }

    public registerCommandInvokingCargoBuildUsingBuildArgs(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.executeBuildTask();
        });
    }

    public registerCommandHelpingChooseArgsAndInvokingCargoRun(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.customConfigurationChooser.choose('customRunConfigurations').then(args => {
                this.cargoManager.invokeCargoRunWithArgs(args);
            }, () => undefined);
        });
    }

    public registerCommandInvokingCargoRunUsingRunArgs(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.executeRunTask();
        });
    }

    public registerCommandHelpingChooseArgsAndInvokingCargoTest(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.customConfigurationChooser.choose('customTestConfigurations').then(args => {
                this.cargoManager.invokeCargoTestWithArgs(args);
            }, () => undefined);
        });
    }

    public registerCommandInvokingCargoTestUsingTestArgs(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.executeTestTask();
        });
    }

    public registerCommandInvokingCargoWithArgs(commandName: string, cargoCommand: string, ...args: string[]): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.cargoManager.invokeCargo(cargoCommand, args);
        });
    }

    public registerCommandStoppingCargoTask(commandName: string): vscode.Disposable {
        return vscode.commands.registerCommand(commandName, () => {
            this.cargoManager.stopTask();
        });
    }

    private helpCreatePlayground(): void {
        const logger = this.logger.createChildLogger('helpCreatePlayground: ');

        const playgroundProjectTypes = ['application', 'library'];

        vscode.window.showQuickPick(playgroundProjectTypes)
            .then((playgroundProjectType: string | undefined) => {
                if (playgroundProjectType === undefined) {
                    logger.debug('quick pick has been cancelled');

                    return;
                }

                tmp.dir((err, path) => {
                    if (err) {
                        this.logger.error(`Temporary directory creation failed: ${err}`);

                        vscode.window.showErrorMessage('Temporary directory creation failed');

                        return;
                    }

                    const crateType = playgroundProjectType === 'application' ? CrateType.Application : CrateType.Library;

                    const name = `playground_${playgroundProjectType}`;

                    this.cargoManager.invokeCargoInit(crateType, name, path)
                        .then(() => {
                            const uri = vscode.Uri.parse(path);

                            vscode.commands.executeCommand('vscode.openFolder', uri, true);
                        });
                });
            });
    }
}

function getConfiguration(): vscode.WorkspaceConfiguration {
    return vscode.workspace.getConfiguration('rust');
}
