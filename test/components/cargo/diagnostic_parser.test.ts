import * as assert from 'assert';

import { Diagnostic, DiagnosticSeverity, Range } from 'vscode';

import { DiagnosticParser } from '../../../src/components/cargo/diagnostic_parser';

suite('Diagnostic Parser Tests', () => {
    test('Simple diagnostic without label', () => {
        // src/main.rs:
        // fn main() {
        //     let f = (1, 2);
        //     f.1 = 5;
        // }

        const diagnosticParser = new DiagnosticParser();

        const diagnostics = diagnosticParser.parseLine(`
{
    "message": {
        "children": [],
        "code": null,
        "level": "error",
        "message": "cannot assign to immutable anonymous field \`f.1\`",
        "rendered": null,
        "spans": [
            {
                "byte_end": 43,
                "byte_start": 36,
                "column_end": 12,
                "column_start": 5,
                "expansion": null,
                "file_name": "src/main.rs",
                "is_primary": true,
                "label": null,
                "line_end": 3,
                "line_start": 3,
                "suggested_replacement": null,
                "text": [{"highlight_end": 12, "highlight_start": 5, "text": "    f.1 = 5;"}]
            }
        ]
    },
    "package_id": "b 0.1.0 (path+file:///tmp/b)",
    "reason": "compiler-message",
    "target": {"kind": ["bin"], "name": "b", "src_path": "/tmp/b/src/main.rs"}
}
        `);

        assert.deepStrictEqual(diagnostics, [
            {
                filePath: 'src/main.rs',
                diagnostic: new Diagnostic(
                    new Range(2, 4, 2, 11),
                    'cannot assign to immutable anonymous field `f.1`',
                    DiagnosticSeverity.Error
                )
            }
        ]);
    });

    test('Simple diagnostic with children', () => {
        // src/main.rs:
        // fn main() {
        //     let f = (1, 2);
        //     f.1 = 5;
        // }

        const diagnosticParser = new DiagnosticParser();

        const diagnostics = diagnosticParser.parseLine(`
{
    "message": {
        "children": [],
        "code": null,
        "level": "error",
        "message": "cannot assign to immutable anonymous field \`f.1\`",
        "rendered": null,
        "spans": [
            {
                "byte_end": 43,
                "byte_start": 36,
                "column_end": 12,
                "column_start": 5,
                "expansion": null,
                "file_name": "src/main.rs",
                "is_primary": true,
                "label": null,
                "line_end": 3,
                "line_start": 3,
                "suggested_replacement": null,
                "text": [{"highlight_end": 12, "highlight_start": 5, "text": "    f.1 = 5;"}]
            }
        ]
    },
    "package_id": "b 0.1.0 (path+file:///tmp/b)",
    "reason": "compiler-message",
    "target": {"kind": ["bin"], "name": "b", "src_path": "/tmp/b/src/main.rs"}
}
        `);

        assert.deepStrictEqual(diagnostics, [
            {
                filePath: 'src/main.rs',
                diagnostic: new Diagnostic(
                    new Range(2, 4, 2, 11),
                    'cannot assign to immutable anonymous field `f.1`',
                    DiagnosticSeverity.Error
                )
            }
        ]);
    });

    test('Complex diagnostic', () => {
        // src/main.rs:
        // fn main() {
        //     let mut x = &5;
        //     {
        //         let y = 5;
        //         x = &y;
        //     }
        // }

        const diagnosticParser = new DiagnosticParser();

        const diagnostics = diagnosticParser.parseLine(`
{
    "message": {
        "children": [],
        "code": null,
        "level": "error",
        "message": "\`y\` does not live long enough",
        "rendered": null,
        "spans": [
            {
                "byte_end": 71,
                "byte_start": 70,
                "column_end": 15,
                "column_start": 14,
                "expansion": null,
                "file_name": "src/main.rs",
                "is_primary": false,
                "label": "borrow occurs here",
                "line_end": 5,
                "line_start": 5,
                "suggested_replacement": null,
                "text": [{"highlight_end": 15, "highlight_start": 14, "text": "        x = &y;"}]
            },
            {
                "byte_end": 78,
                "byte_start": 77,
                "column_end": 6,
                "column_start": 5,
                "expansion": null,
                "file_name": "src/main.rs",
                "is_primary": true,
                "label": "\`y\` dropped here while still borrowed",
                "line_end": 6,
                "line_start": 6,
                "suggested_replacement": null,
                "text": [{"highlight_end": 6, "highlight_start": 5, "text": "    }"}]
            },
            {
                "byte_end": 80,
                "byte_start": 79,
                "column_end": 2,
                "column_start": 1,
                "expansion": null,
                "file_name": "src/main.rs",
                "is_primary": false,
                "label": "borrowed value needs to live until here",
                "line_end": 7,
                "line_start": 7,
                "suggested_replacement": null,
                "text": [{"highlight_end": 2, "highlight_start": 1, "text": "}"}]
            }
        ]
    },
    "package_id": "b 0.1.0 (path+file:///tmp/b)",
    "reason": "compiler-message",
    "target": {"kind": ["bin"], "name": "b", "src_path": "/tmp/b/src/main.rs"}
}
        `);

        assert.deepStrictEqual(diagnostics, [
            {
                filePath: 'src/main.rs',
                diagnostic: new Diagnostic(
                    new Range(4, 13, 4, 14),
                    '(1) borrow occurs here',
                    DiagnosticSeverity.Error
                )
            },
            {
                filePath: 'src/main.rs',
                diagnostic: new Diagnostic(
                    new Range(5, 4, 5, 5),
                    '(1) `y` does not live long enough\n' +
                    '`y` dropped here while still borrowed',
                    DiagnosticSeverity.Error
                )
            },
            {
                filePath: 'src/main.rs',
                diagnostic: new Diagnostic(
                    new Range(6, 0, 6, 1),
                    '(1) borrowed value needs to live until here',
                    DiagnosticSeverity.Error
                )
            }
        ]);
    });
});
