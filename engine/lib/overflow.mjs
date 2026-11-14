// A request whose headers are over Node's limit (16 KB) is answered, never dropped (T58d N1): 431, and the browser
// told to forget its cookies for that host (Clear-Site-Data: "cookies"), so huge cookies a page once left for
// 127.0.0.1 cannot keep the owner's browser out of the home screen or the preview: the next request is small
// again. Every other broken request is answered as Node answers it. Given to a server's "clientError".
// Zero dependencies; used by the home server and the owner's preview.
export const OVERFLOW_SENTENCE = "The request's headers were too large. This browser's cookies for this address are cleared: load the page again.";

export function headerOverflow(err, socket) {
  if (socket.writable && socket.bytesWritten === 0) {
    const code = err && err.code;
    if (code === "HPE_HEADER_OVERFLOW") {
      socket.write("HTTP/1.1 431 Request Header Fields Too Large\r\nClear-Site-Data: \"cookies\"\r\nContent-Type: text/plain; charset=utf-8\r\n" +
        `Content-Length: ${Buffer.byteLength(OVERFLOW_SENTENCE)}\r\nCache-Control: no-store\r\nX-Content-Type-Options: nosniff\r\nConnection: close\r\n\r\n${OVERFLOW_SENTENCE}`);
    } else if (code === "ERR_HTTP_REQUEST_TIMEOUT") {
      socket.write("HTTP/1.1 408 Request Timeout\r\nConnection: close\r\n\r\n");
    } else if (code === "HPE_CHUNK_EXTENSIONS_OVERFLOW") {
      socket.write("HTTP/1.1 413 Payload Too Large\r\nConnection: close\r\n\r\n");
    } else {
      socket.write("HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n");
    }
  }
  socket.destroy(err);
}
