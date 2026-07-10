use serde::{Deserialize, Serialize};
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::process::Command;

#[derive(Debug, Deserialize)]
pub struct TranslateRequest {
    pub text: String,
    pub engine: Option<String>,
    pub target_language: Option<String>,
    pub api_base_url: Option<String>,
    pub api_key: Option<String>,
    pub model: Option<String>,
    pub volc_access_key: Option<String>,
    pub volc_secret_key: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct TranslateResponse {
    pub translated_text: String,
    pub raw: Value,
}

#[derive(Clone, Copy, Debug)]
enum TranslationTarget {
    SimplifiedChinese,
    English,
    Japanese,
    Korean,
}

impl TranslationTarget {
    fn openai_target_label(self) -> &'static str {
        match self {
            Self::SimplifiedChinese => "Simplified Chinese",
            Self::English => "English",
            Self::Japanese => "Japanese",
            Self::Korean => "Korean",
        }
    }

    fn volc_target_language(self) -> &'static str {
        match self {
            Self::SimplifiedChinese => "zh",
            Self::English => "en",
            Self::Japanese => "ja",
            Self::Korean => "ko",
        }
    }
}

pub fn translate_text(request: TranslateRequest) -> Result<TranslateResponse, String> {
    let text = request.text.trim();
    if text.is_empty() {
        return Err("请输入需要翻译的文本。".to_string());
    }
    let target = resolve_translation_target(text, request.target_language.as_deref())?;

    match request
        .engine
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("openai-compatible")
    {
        "openai-compatible" | "openai" => {
            translate_with_openai_compatible(&request, text, target)
        }
        "volcengine" | "volc" => translate_with_volcengine(&request, text, target),
        engine => Err(format!("不支持的翻译引擎: {engine}")),
    }
}

fn translate_with_openai_compatible(
    request: &TranslateRequest,
    text: &str,
    target: TranslationTarget,
) -> Result<TranslateResponse, String> {
    let api_key = request
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请先在设置中配置翻译 API Key。".to_string())?;
    let endpoint = normalize_endpoint(request.api_base_url.as_deref())?;
    let model = request
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("gpt-4o-mini");

    let payload = json!({
        "model": model,
        "messages": [
            {
                "role": "system",
                "content": "You are a precise translation engine. Return only the translated text. Translate the user's text into the requested target language."
            },
            {
                "role": "user",
                "content": format!(
                    "Target language: {}.\n\nText:\n{text}",
                    target.openai_target_label()
                )
            }
        ],
        "temperature": 0
    });

    let output = Command::new("curl")
        .arg("-sS")
        .arg("-m")
        .arg("60")
        .arg("-X")
        .arg("POST")
        .arg("-H")
        .arg(format!("Authorization: Bearer {api_key}"))
        .arg("-H")
        .arg("Content-Type: application/json")
        .arg("-d")
        .arg(payload.to_string())
        .arg(endpoint)
        .output()
        .map_err(|error| format!("启动翻译请求失败: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "翻译请求失败: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let raw: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        format!(
            "解析翻译响应失败: {error}: {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })?;
    let translated_text = raw
        .pointer("/choices/0/message/content")
        .and_then(Value::as_str)
        .or_else(|| raw.pointer("/choices/0/text").and_then(Value::as_str))
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("翻译响应中没有可用文本: {raw}"))?
        .to_string();

    Ok(TranslateResponse {
        translated_text,
        raw,
    })
}

fn translate_with_volcengine(
    request: &TranslateRequest,
    text: &str,
    target: TranslationTarget,
) -> Result<TranslateResponse, String> {
    const HOST: &str = "translate.volcengineapi.com";
    const REGION: &str = "cn-north-1";
    const SERVICE: &str = "translate";
    const CANONICAL_QUERY: &str = "Action=TranslateText&Version=2020-06-01";

    let access_key = request
        .volc_access_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请先在设置中配置火山翻译 Access Key。".to_string())?;
    let secret_key = request
        .volc_secret_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "请先在设置中配置火山翻译 Secret Key。".to_string())?;

    let mut payload = Map::new();
    payload.insert(
        "TargetLanguage".to_string(),
        json!(target.volc_target_language()),
    );
    payload.insert("TextList".to_string(), json!([text]));
    let payload = Value::Object(payload);
    let payload_text = payload.to_string();
    let payload_hash = sha256_hex(payload_text.as_bytes());
    let x_date = utc_date("+%Y%m%dT%H%M%SZ")?;
    let short_date = utc_date("+%Y%m%d")?;
    let signed_headers = "content-type;host;x-content-sha256;x-date";
    let canonical_headers = format!(
        "content-type:application/json\nhost:{HOST}\nx-content-sha256:{payload_hash}\nx-date:{x_date}\n"
    );
    let canonical_request = format!(
        "POST\n/\n{CANONICAL_QUERY}\n{canonical_headers}\n{signed_headers}\n{payload_hash}"
    );
    let credential_scope = format!("{short_date}/{REGION}/{SERVICE}/request");
    let string_to_sign = format!(
        "HMAC-SHA256\n{x_date}\n{credential_scope}\n{}",
        sha256_hex(canonical_request.as_bytes())
    );
    let signing_key = volc_signing_key(secret_key.as_bytes(), &short_date, REGION, SERVICE);
    let signature = hex::encode(hmac_sha256(&signing_key, string_to_sign.as_bytes()));
    let authorization = format!(
        "HMAC-SHA256 Credential={access_key}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    );
    let endpoint = format!("https://{HOST}/?{CANONICAL_QUERY}");

    let output = Command::new("curl")
        .arg("-sS")
        .arg("-m")
        .arg("60")
        .arg("-X")
        .arg("POST")
        .arg("-H")
        .arg(format!("Authorization: {authorization}"))
        .arg("-H")
        .arg(format!("X-Date: {x_date}"))
        .arg("-H")
        .arg(format!("X-Content-Sha256: {payload_hash}"))
        .arg("-H")
        .arg("Content-Type: application/json")
        .arg("-d")
        .arg(payload_text)
        .arg(endpoint)
        .output()
        .map_err(|error| format!("启动火山翻译请求失败: {error}"))?;

    if !output.status.success() {
        return Err(format!(
            "火山翻译请求失败: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    let raw: Value = serde_json::from_slice(&output.stdout).map_err(|error| {
        format!(
            "解析火山翻译响应失败: {error}: {}",
            String::from_utf8_lossy(&output.stdout)
        )
    })?;
    if let Some(error) = raw.pointer("/ResponseMetadata/Error") {
        return Err(format!("火山翻译请求失败: {error}"));
    }
    let translated_text = extract_volc_translation(&raw)
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| format!("火山翻译响应中没有可用文本: {raw}"))?
        .to_string();

    Ok(TranslateResponse {
        translated_text,
        raw,
    })
}

fn normalize_endpoint(value: Option<&str>) -> Result<String, String> {
    let base = value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .ok_or_else(|| "请先在设置中配置翻译 API Base URL。".to_string())?;

    if base.contains("/chat/completions") {
        return Ok(base.to_string());
    }

    Ok(format!(
        "{}/v1/chat/completions",
        base.trim_end_matches('/')
    ))
}

fn resolve_translation_target(text: &str, value: Option<&str>) -> Result<TranslationTarget, String> {
    match value.map(str::trim).filter(|item| !item.is_empty()).unwrap_or("auto") {
        "auto" => Ok(infer_translation_target(text)),
        "zh" | "zh-Hans" | "zh_cn" | "zh-CN" => Ok(TranslationTarget::SimplifiedChinese),
        "en" | "en-US" | "en-GB" => Ok(TranslationTarget::English),
        "ja" | "jp" | "ja-JP" => Ok(TranslationTarget::Japanese),
        "ko" | "ko-KR" => Ok(TranslationTarget::Korean),
        language => Err(format!("不支持的翻译目标语言: {language}")),
    }
}

fn infer_translation_target(text: &str) -> TranslationTarget {
    if is_likely_simplified_chinese(text) {
        TranslationTarget::English
    } else {
        TranslationTarget::SimplifiedChinese
    }
}

fn is_likely_simplified_chinese(text: &str) -> bool {
    let mut han_count = 0usize;
    let mut traditional_only_count = 0usize;
    let mut kana_count = 0usize;

    for character in text.chars() {
        if is_han(character) {
            han_count += 1;
            if is_common_traditional_only(character) {
                traditional_only_count += 1;
            }
        } else if is_kana(character) {
            kana_count += 1;
        }
    }

    han_count > 0 && kana_count == 0 && traditional_only_count == 0
}

fn is_han(character: char) -> bool {
    ('\u{4e00}'..='\u{9fff}').contains(&character)
        || ('\u{3400}'..='\u{4dbf}').contains(&character)
        || ('\u{20000}'..='\u{2a6df}').contains(&character)
}

fn is_kana(character: char) -> bool {
    ('\u{3040}'..='\u{30ff}').contains(&character) || ('\u{31f0}'..='\u{31ff}').contains(&character)
}

fn is_common_traditional_only(character: char) -> bool {
    const TRADITIONAL_ONLY: &str = "們個來會時說對為這與還過後從裡見問無開關長門間風電車馬魚鳥龍國學體書畫話語貓貝買賣讓識讀寫聽歡樂東臺台灣灣廣歲條發髮復複幾應當當歸龜麵點齊齒齡醫藥舊雲鄉鄰鄭鄧劉陳張趙錢孫楊黃吳週葉愛萬億氣實際價產業務辦別劃劇劍劑務動勝勞勢勳區協單賽參雙變號嘗嚴圓圖團壓壞塊報場堅墮壘壯聲壺壽夠夢夥夾奪奮婦媽妝姍娛婁嬰學寧寶將專尋導對層屬嵐嶺嶽幣幫幹庫廁廂廈廚廟廠廣廳弔彈強彌彎彙彞彥徑從復徵德憂憑懷懸懲懶懺懼戀戰戶拋挾捨掃掄掙掛採揚換揮損搖搶摑摟摯摺擁擇擊擋擔據擠擬擱擴擲擾攜攝敵數斂斃斬斷於昇晝暈暢暫曆曉曬書會朧東極構槍樣樁樂樞標樓樹橋機橫檔檢櫃權歡歐歲歷歸殘殼毀氈氣氫氧氯沖決況淨淚淵淺渦測渾湊湯準溝滅滌滯滲滾滿漁漚漢漲漿潁潛潤潑潔澀濁濃濕瀉瀋瀏瀕灣為烏無煉煙煩燒燙熱燭爭爾牆牽犧狀獎獨獲獸環現瑣璽畫異疇療癒發盜盞盡監盤盧眾睏矚礎禮禍禪離禿稅穀穩窩窮竄竅竊競筆築範篤簡簾籃糧糾紀約紅紋納紐純紗紙級紛素紡索緊紫累細紳紹終組結絕絛給絨統絲絹綁經綜綠維綱網綴綵綸綺綻綽綾綿緇緊緒線緝緞締緣編緩緯練縣縫縮縱總績繁繃織繕繞繡繩繪繫繭繳繹續纏纖纜缽罈罷羅羈羋習翹聖聞聯聰聲聳職聶膽臉臘臟臨舉艱艷藝節莊華萬萊蓋蔔蔣蕭薑藍蘋虛處號衛衝補裝裡製複襯視覽覺觸訁訂計訊討訓託記訟訣訪設許訴診註詐詔評詠試詩詫該詳誇誌認誕誘語誠誤說誰課誼調談請諒論諸諾謀謂謙講謝謠謹證識譜譯議護譽讀變讎讓豐豬貞負財責賢敗賬貨質販貪貫貳貴貸貿賀賃賄資賈賊賓賜賞賠賢賣賤賦賬賭賴賺賽購贈贊贏贛趕趙趨跡踐踴蹟軀車軋軌軍軒軟軸較載輔輕輛輝輩輪輯輸轄轅轉轍轟辦辭辯農迴遞遠適遲遷選遺遙鄧鄰鄭醜醫釀釁釋里釐針釘釣鈔鈴鉛銀銅銘銜銳銷鋁鋒鋼錄錢錦錶鍋鍊錯鍾鎂鎖鎮鏡鐵鑑鑰鑽長門閃閉開閑間閣閱隊陽陰陣階際陸險隨隱隸雜雞離難雲電霧霽靈靜頂項順須頑顧頓頒頌預領頗頻題額顏類願顛風飛飯飲飾餅餘館饋饒饑馬駁駐駕駛驗騎騰驅驚體髒鬆鬥鬧鬱魚魯鮮鯉鯨鳥鳴鳳鴻鵝鷹鹽麗麥麼黃點黨齊齋齒齡龍龐";
    TRADITIONAL_ONLY.contains(character)
}

fn extract_volc_translation(raw: &Value) -> Option<String> {
    let translations = raw
        .pointer("/TranslationList")
        .and_then(Value::as_array)
        .or_else(|| {
            raw.pointer("/Response/TranslationList")
                .and_then(Value::as_array)
        })?;
    let values: Vec<&str> = translations
        .iter()
        .filter_map(|item| {
            item.get("Translation")
                .and_then(Value::as_str)
                .or_else(|| item.get("TranslatedText").and_then(Value::as_str))
                .or_else(|| item.get("Text").and_then(Value::as_str))
        })
        .collect();

    if values.is_empty() {
        None
    } else {
        Some(values.join("\n"))
    }
}

fn utc_date(format: &str) -> Result<String, String> {
    let output = Command::new("date")
        .arg("-u")
        .arg(format)
        .output()
        .map_err(|error| format!("生成火山翻译签名时间失败: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "生成火山翻译签名时间失败: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn sha256_hex(value: &[u8]) -> String {
    hex::encode(Sha256::digest(value))
}

fn volc_signing_key(secret_key: &[u8], date: &str, region: &str, service: &str) -> Vec<u8> {
    let date_key = hmac_sha256(secret_key, date.as_bytes());
    let region_key = hmac_sha256(&date_key, region.as_bytes());
    let service_key = hmac_sha256(&region_key, service.as_bytes());
    hmac_sha256(&service_key, b"request")
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    const BLOCK_SIZE: usize = 64;
    let mut key_block = if key.len() > BLOCK_SIZE {
        Sha256::digest(key).to_vec()
    } else {
        key.to_vec()
    };
    key_block.resize(BLOCK_SIZE, 0);

    let mut outer_pad = [0x5c_u8; BLOCK_SIZE];
    let mut inner_pad = [0x36_u8; BLOCK_SIZE];
    for (index, item) in key_block.iter().enumerate() {
        outer_pad[index] ^= item;
        inner_pad[index] ^= item;
    }

    let mut inner = Sha256::new();
    inner.update(inner_pad);
    inner.update(data);
    let inner_hash = inner.finalize();

    let mut outer = Sha256::new();
    outer.update(outer_pad);
    outer.update(inner_hash);
    outer.finalize().to_vec()
}
