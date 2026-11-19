# Modelos de reconhecimento local

Modelos LSTM do projeto oficial [tesseract-ocr/tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast), distribuídos sob Apache License 2.0. A licença acompanha esta pasta em `LICENSE`.

- `por.traineddata`: português, obtido de https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/por.traineddata
- `eng.traineddata`: inglês, obtido de https://raw.githubusercontent.com/tesseract-ocr/tessdata_fast/main/eng.traineddata

Os modelos são carregados do disco pelo Tesseract.js. O aplicativo não baixa modelos nem envia páginas para serviços externos durante o reconhecimento.
