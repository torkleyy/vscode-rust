import { Diagnostic, DiagnosticSeverity, Range } from 'vscode';

import { FileDiagnostic } from './file_diagnostic';

interface CompilerMessageSpanText {
    highlight_end: number;
    highlight_start: number;
    text: string;
}

interface CompilerMessageCode {
    code: string;
    explanation: string;
}

interface CompilerMessageSpanExpansion {
    def_site_span: CompilerMessageSpan;
    macro_decl_name: string;
    span: CompilerMessageSpan;
}

interface CompilerMessageSpan {
    byte_end: number;
    byte_start: number;
    column_end: number;
    column_start: number;
    expansion?: CompilerMessageSpanExpansion;
    file_name: string;
    is_primary: boolean;
    label: string;
    line_end: number;
    line_start: number;
    suggested_replacement?: any; // I don't know what type it has
    text: CompilerMessageSpanText[];
}

interface CompilerMessage {
    children: any[]; // I don't know what type it has
    code?: CompilerMessageCode;
    level: string;
    message: string;
    rendered?: any; // I don't know what type it has
    spans: CompilerMessageSpan[];
}

interface CargoMessageTarget {
    kind: string[];
    name: string;
    src_path: string;
}

interface CargoMessageWithCompilerMessage {
    message: CompilerMessage;
    package_id: string;
    reason: 'compiler-message';
    target: CargoMessageTarget;
}

interface CargoMessageWithCompilerArtifact {
    features: any[];
    filenames: string[];
    package_id: string;
    profile: any;
    reason: 'compiler-artifact';
    target: CargoMessageTarget;
}

/**
 * The class implementing parsing a diagnostic from Cargo.
 * An instance of the class must be used for sole invocation of a cargo command
 */
export class DiagnosticParser {
    private complexMessageIndex: number;

    public constructor() {
        this.complexMessageIndex = 0;
    }

    /**
     * Parses diagnostics from a line
     * @param line A line to parse
     * @return parsed diagnostics
     */
    public parseLine(line: string): FileDiagnostic[] {
        const cargoMessage: CargoMessageWithCompilerArtifact | CargoMessageWithCompilerMessage =
            JSON.parse(line);

        if (cargoMessage.reason === 'compiler-message') {
            return this.parseCompilerMessage(cargoMessage.message);
        } else {
            return [];
        }
    }

    private parseCompilerMessage(compilerMessage: CompilerMessage): FileDiagnostic[] {
        if (compilerMessage.spans.length === 0) {
            return [];
        }

        if (this.isComplexCompilerMessage(compilerMessage)) {
            ++this.complexMessageIndex;
            return this.parseComplexCompilerMessage(compilerMessage);
        } else {
            return this.parseSimpleCompilerMessage(compilerMessage);
        }
    }

    /**
     * Determines whether the compiler message is complex.
     * A complex compiler message is a compiler message which cannot be represented with one diagnostic.
     * @param compilerMessage The compiler message
     * @return Is the compiler message complex
     */
    private isComplexCompilerMessage(compilerMessage: CompilerMessage): boolean {
        if (compilerMessage.spans.length === 0) {
            throw new Error('A compiler message must have spans');
        }

        if (compilerMessage.spans.length > 1) {
            return true;
        }

        if (compilerMessage.spans[0].expansion) {
            return true;
        } else {
            return false;
        }
    }

    private parseComplexCompilerMessage(compilerMessage: CompilerMessage): FileDiagnostic[] {
        const diagnostics: FileDiagnostic[] = [];

        for (const span of compilerMessage.spans) {
            const range = new Range(
                span.line_start - 1,
                span.column_start - 1,
                span.line_end - 1,
                span.column_end - 1
            );

            let message = `(${this.complexMessageIndex}) `;

            if (compilerMessage.code) {
                message += `${compilerMessage.code.code}: `;
            }

            if (span.is_primary) {
                message += compilerMessage.message;

                if (span.label) {
                    message += `\n${span.label}`;
                }

                message += this.childrenToString(compilerMessage.children, 1);
            } else if (span.label) {
                message += `${span.label}`;
            } else {
                continue;
            }

            const diagnostic = new Diagnostic(range, message, this.toSeverity(compilerMessage.level));

            const fileDiagnostic = { filePath: span.file_name, diagnostic };

            diagnostics.push(fileDiagnostic);
        }

        return diagnostics;
    }

    private parseSimpleCompilerMessage(compilerMessage: CompilerMessage): FileDiagnostic[] {
        // const spans = compilerMessage.spans;

        // // Only add the primary span, as VSCode orders the problem window by the
        // // error's range, which causes a lot of confusion if there are duplicate messages.
        // let primarySpan = spans.find(span => span.is_primary);

        // if (!primarySpan) {
        //     return [];
        // }

        // // Following macro expansion to get correct file name and range.
        // while (primarySpan.expansion && primarySpan.expansion.span) {
        //     primarySpan = primarySpan.expansion.span;
        // }

        const span = compilerMessage.spans[0];

        const range = new Range(
            span.line_start - 1,
            span.column_start - 1,
            span.line_end - 1,
            span.column_end - 1
        );

        let message = '';

        if (compilerMessage.code) {
            message += `${compilerMessage.code.code}: `;
        }

        message += compilerMessage.message;

        if (span.label) {
            message += `\n${span.label}`;
        }

        message += this.childrenToString(compilerMessage.children, 1);

        const diagnostic = new Diagnostic(range, message, this.toSeverity(compilerMessage.level));

        const fileDiagnostic = { filePath: span.file_name, diagnostic };

        return [fileDiagnostic];
    }

    private toSeverity(severity: string): DiagnosticSeverity {
        switch (severity) {
            case 'warning':
                return DiagnosticSeverity.Warning;

            case 'note':
                return DiagnosticSeverity.Information;

            case 'help':
                return DiagnosticSeverity.Hint;

            default:
                return DiagnosticSeverity.Error;
        }
    }

    private childrenToString(children: any[], level: number): string {
        let message = '';
        const indentation = '  '.repeat(level);

        for (const child of children) {
            message += `\n${indentation}${child.level}: ${child.message}`;

            if (child.children) {
                message += this.childrenToString(child.children, level + 1);
            }
        }

        return message;
    }
}
