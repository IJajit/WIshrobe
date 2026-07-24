export default function handler(req: any, res: any) {
  res.status(200).json({ ok: true, url: req.url, method: req.method });
}
