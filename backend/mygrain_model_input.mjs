// Streamed reads tolerate non-blocking pipes and prompts larger than a pipe buffer.
// setEncoding preserves UTF-8 characters split across incoming chunks.
export async function readModelMessage(stream = process.stdin) {
    stream.setEncoding('utf8');
    let message = '';
    for await (const chunk of stream) {
        message += chunk;
        if (message.length > 250000) throw Error('Invalid recipe request.');
    }
    if (!message) throw Error('Invalid recipe request.');
    return message;
}
