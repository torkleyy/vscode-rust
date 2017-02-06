import { access } from 'fs';

import { dirname, join } from 'path';

import { window, workspace } from 'vscode';

import findUp = require('find-up');

export class CurrentWorkingDirectoryManager {
    private rememberedCwd: string | null;

    public constructor() {
        this.rememberedCwd = null;
    }

    public async cwd(): Promise<string> {
        // Internal description of the method:
        // Issue: https://github.com/KalitaAlexey/vscode-rust/issues/36
        // The algorithm:
        // * Try finding cwd out of an active text editor
        // * If it succeeds:
        //   * Remember the cwd for later use when for some reasons
        //     a cwd wouldn't be find out of an active text editor
        // * Otherwise:
        //   * Try using a previous cwd
        //   * If there is previous cwd:
        //     * Use it
        //   * Otherwise:
        //     * Try using workspace as cwd

        try {
            return await this.getCwdFromActiveTextEditor();
        } catch (error) {
            try {
                return await this.getPreviousCwd();
            } catch (previousCwdError) {
                const canBeUsed = await this.checkWorkspaceCanBeUsedAsCwd();

                if (canBeUsed) {
                    return workspace.rootPath;
                } else {
                    throw error;
                }
            }
        }
    }

    private checkWorkspaceCanBeUsedAsCwd(): Promise<boolean> {
        const filePath = join(workspace.rootPath, 'Cargo.toml');

        return this.checkPathExists(filePath);
    }

    private getCwdFromActiveTextEditor(): Promise<string> {
        if (!window.activeTextEditor) {
            return Promise.reject(new Error('No active document'));
        }

        const fileName = window.activeTextEditor.document.fileName;

        if (!fileName.startsWith(workspace.rootPath)) {
            return Promise.reject(new Error('Current document not in the workspace'));
        }

        return this.findCargoTomlUpToWorkspace(dirname(fileName));
    }

    private findCargoTomlUpToWorkspace(cwd: string): Promise<string> {
        const opts = { cwd: cwd };

        return findUp('Cargo.toml', opts).then((cargoTomlDirPath: string) => {
            if (cargoTomlDirPath === null) {
                return Promise.reject(new Error('Cargo.toml hasn\'t been found'));
            }

            if (!cargoTomlDirPath.startsWith(workspace.rootPath)) {
                return Promise.reject(new Error('Cargo.toml hasn\'t been found within the workspace'));
            }

            return Promise.resolve(dirname(cargoTomlDirPath));
        });
    }

    private getPreviousCwd(): Promise<string> {
        if (this.rememberedCwd === undefined) {
            return Promise.reject(undefined);
        }

        const pathToCargoTomlInPreviousCwd = join(this.rememberedCwd, 'Cargo.toml');

        return this.checkPathExists(pathToCargoTomlInPreviousCwd).then<string>(exists => {
            if (exists) {
                return Promise.resolve(this.rememberedCwd);
            } else {
                return Promise.reject(undefined);
            }
        });
    }

    private checkPathExists(path: string): Promise<boolean> {
        return new Promise(resolve => {
            access(path, e => {
                // A path exists if there is no error
                const pathExists = !e;

                resolve(pathExists);
            });
        });
    }
}
