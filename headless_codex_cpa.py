import undetected_chromedriver as uc
from selenium.webdriver.common.by import By
from selenium.webdriver.support.ui import WebDriverWait
from selenium.webdriver.support import expected_conditions as EC
from selenium.webdriver.common.keys import Keys
from selenium.webdriver.common.action_chains import ActionChains
import time
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
import random
import string
import os
import re
import json
from urllib.parse import urlparse, parse_qs
import urllib3

urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ================= Global Configuration =================
TOTAL_ACCOUNTS = 5

# CPA Configuration
CLI_PROXY_MANAGEMENT_URL = "https://ai.golovin.cn/management.html#/oauth"
CLI_PROXY_API_BASE = "https://ai.golovin.cn"
CLI_PROXY_PASSWORD = "🆚016214237"

# Cloudflare Email Configuration
CF_WORKER_DOMAIN = "golovin.work"
CF_EMAIL_DOMAIN = "mailto.plus"
CF_ADMIN_PASSWORD = "Vs2016"

# Output Files
ACCOUNTS_FILE = "accounts.txt"
CSV_FILE = "registered_accounts.csv"

# ================= Helper Functions =================
def create_session_with_retry():
    session = requests.Session()
    retry_strategy = Retry(
        total=5,
        backoff_factor=1,
        status_forcelist=[429, 500, 502, 503, 504],
        allowed_methods=["HEAD", "GET", "POST", "OPTIONS"],
    )
    adapter = HTTPAdapter(max_retries=retry_strategy)
    session.mount("https://", adapter)
    session.mount("http://", adapter)
    return session

http_session = create_session_with_retry()

def get_random_user_agent():
    return "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36"

def generate_random_password(length=16):
    chars = string.ascii_letters + string.digits + "!@#$%"
    password = "".join(random.choice(chars) for _ in range(length))
    password = (
        random.choice(string.ascii_uppercase)
        + random.choice(string.ascii_lowercase)
        + random.choice(string.digits)
        + random.choice("!@#$%")
        + password[4:]
    )
    return password

def save_account(email: str, password: str):
    """Save account to both txt and csv"""
    try:
        with open(ACCOUNTS_FILE, "a", encoding="utf-8") as f:
            f.write(f"{email}:{password}\n")
        
        file_exists = os.path.exists(CSV_FILE)
        with open(CSV_FILE, "a", newline="", encoding="utf-8") as f:
            import csv
            writer = csv.writer(f)
            if not file_exists:
                writer.writerow(["email", "password", "timestamp"])
            writer.writerow([email, password, time.strftime("%Y-%m-%d %H:%M:%S")])
            
        print(f"✅ Account saved to {ACCOUNTS_FILE} and {CSV_FILE}")
    except Exception as e:
        print(f"⚠️ Failed to save account: {e}")

# ================= Cloudflare Email Functions (From codex.py) =================
def create_temp_email():
    print("Creating temporary email via Cloudflare...")
    url = f"https://{CF_WORKER_DOMAIN}/admin/new_address"
    try:
        letters1 = ''.join(random.choices(string.ascii_lowercase, k=random.randint(4, 6)))
        numbers = ''.join(random.choices(string.digits, k=random.randint(1, 3)))
        letters2 = ''.join(random.choices(string.ascii_lowercase, k=random.randint(0, 5)))
        random_name = letters1 + numbers + letters2

        res = requests.post(
            url,
            json={
                "enablePrefix": True,
                "name": random_name,
                "domain": CF_EMAIL_DOMAIN,
            },
            headers={
                'x-admin-auth': CF_ADMIN_PASSWORD,
                "Content-Type": "application/json"
            },
            timeout=10,
            verify=False
        )
        if res.status_code == 200:
            data = res.json()
            cf_token = data.get('jwt')
            cf_email = data.get('address')
            if cf_email:
                print(f"✅ Email created: {cf_email}")
                return cf_email, cf_token
            else:
                print("[-] Creating email response missing address")
        else:
            print(f"[-] Creating email failed: {res.status_code} - {res.text}")
    except Exception as e:
        print(f"❌ Email creation error: {e}")
    return None, None

def fetch_emails(email: str, cf_token: str):
    try:
        res = requests.get(
            f"https://{CF_WORKER_DOMAIN}/api/mails",
            params={"limit": 10, "offset": 0},
            headers={
                "Authorization": f"Bearer {cf_token}",
                "Content-Type": "application/json"
            },
            verify=False,
            timeout=30
        )
        if res.status_code == 200:
            data = res.json()
            if data.get("results"):
                return data["results"]
            return []
        else:
            print(f"  Fetch emails failed: HTTP {res.status_code}")
    except Exception as e:
        print(f"  Fetch emails error: {e}")
    return None

def extract_verification_code(email_content: str):
    if not email_content:
        return None
    patterns = [
        r"Verification code:?\s*(\d{6})",
        r"code is\s*(\d{6})",
        r"代码为[:：]?\s*(\d{6})",
        r"验证码[:：]?\s*(\d{6})",
        r">\s*(\d{6})\s*<",
        r"(?<![#&])\b(\d{6})\b",
    ]
    for pattern in patterns:
        matches = re.findall(pattern, email_content, re.IGNORECASE)
        for code in matches:
            if code == "177010": # Known false positive
                continue
            print(f"  ✅ Extracted code: {code}")
            return code
    return None

def wait_for_verification_email(email: str, cf_token: str, timeout: int = 120):
    print(f"Waiting for verification email (max {timeout}s)...")
    start_time = time.time()
    while time.time() - start_time < timeout:
        emails = fetch_emails(email, cf_token)
        if emails and len(emails) > 0:
            for email_item in emails:
                if not isinstance(email_item, dict): continue
                
                sender = email_item.get("source", "").lower()
                if "openai" in sender:
                    raw_content = email_item.get("raw", "")
                    code = extract_verification_code(raw_content)
                    if code: return code
        
        elapsed = int(time.time() - start_time)
        print(f"  Waiting... ({elapsed}s)", end="\r")
        time.sleep(3)
    print("\n⏰ Timeout waiting for email")
    return None

# ================= CPA Logic (From oaiauto.py) =================

def _wait_oauth_page_loaded(driver, timeout=20):
    WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.CSS_SELECTOR, "div.card"))
    )

def _navigate_to_oauth_page(driver, max_attempts=6):
    for attempt in range(1, max_attempts + 1):
        try:
            driver.get(CLI_PROXY_MANAGEMENT_URL)
        except Exception:
            pass
        time.sleep(2)
        if driver.find_elements(By.CSS_SELECTOR, "div.card"):
            return True
        try:
            nav_candidates = driver.find_elements(
                By.XPATH,
                "//a[contains(., 'OAuth') or contains(., 'oauth') or contains(., '授权') or contains(., '认证')] | //button[contains(., 'OAuth') or contains(., 'oauth') or contains(., '授权') or contains(., '认证')]"
            )
            for nav in nav_candidates:
                if not nav.is_displayed(): continue
                try:
                    driver.execute_script("arguments[0].click();", nav)
                    time.sleep(2)
                    if driver.find_elements(By.CSS_SELECTOR, "div.card"): return True
                except Exception: continue
        except Exception: pass
        print(f"   OAuth page not ready, retrying ({attempt}/{max_attempts})")
    return False

def _get_codex_oauth_card(driver):
    _wait_oauth_page_loaded(driver, timeout=20)
    time.sleep(1)
    cards = driver.find_elements(By.CSS_SELECTOR, "div.card")
    for card in cards:
        try:
            if "Codex OAuth" in card.text or "Codex" in card.text:
                return card
        except Exception: continue
    return None

def login_cli_proxy_panel(driver):
    print("\n🔐 Logging into CPA Management Panel...")
    driver.get(CLI_PROXY_MANAGEMENT_URL)
    time.sleep(2)
    if driver.find_elements(By.CSS_SELECTOR, "div.card"):
        return True
    
    if not driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]'):
        if _navigate_to_oauth_page(driver): return True

    try:
        password_input = WebDriverWait(driver, 20).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, 'input[type="password"]'))
        )
        password_input.clear()
        password_input.send_keys(CLI_PROXY_PASSWORD)
        login_btn = WebDriverWait(driver, 10).until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, "button.btn.btn-primary"))
        )
        driver.execute_script("arguments[0].click();", login_btn)
        time.sleep(2)
        if _navigate_to_oauth_page(driver): return True
    except Exception as e:
        print(f"❌ Login CPA failed: {e}")
    return False

def _extract_auth_url_from_card(driver, codex_card):
    try:
        card_text = codex_card.text
        urls = re.findall(r'https://auth\.openai\.com/(?:oauth/)?authorize[^\s<>\'\)]+', card_text)
        if urls: return urls[0].replace("&amp;", "&")
        
        page_source = driver.page_source
        urls = re.findall(r'https://auth\.openai\.com/(?:oauth/)?authorize[^\s"<>\'\)]+', page_source)
        if urls: return urls[0].replace("&amp;", "&")
    except Exception as e:
        print(f"   Extract auth link failed: {e}")
    return None

def get_codex_oauth_auth_link(driver):
    print("\n🔗 Getting Codex OAuth Auth Link...")
    if not login_cli_proxy_panel(driver): return None
    
    try:
        codex_card = _get_codex_oauth_card(driver)
        if not codex_card: return None

        # Check if link exists (Open button)
        try:
            open_link_btn = codex_card.find_element(By.XPATH, ".//button[contains(text(), '打开链接') or contains(text(), 'Open')]")
            if open_link_btn.is_displayed():
                auth_url = _extract_auth_url_from_card(driver, codex_card)
                if auth_url: return auth_url
        except Exception: pass

        # Click Login
        login_btn = None
        try:
            login_btn = codex_card.find_element(By.CSS_SELECTOR, "button.btn-primary")
        except:
            pass
        
        if not login_btn:
            buttons = codex_card.find_elements(By.TAG_NAME, "button")
            for btn in buttons:
                if btn.text.strip() in ["登录", "Login", "login"]:
                    login_btn = btn
                    break
        
        if login_btn:
            driver.execute_script("arguments[0].click();", login_btn)
            print("   Clicked Login, waiting for link...")
            for _ in range(10):
                time.sleep(1)
                codex_card = _get_codex_oauth_card(driver)
                if not codex_card: continue
                # Try extract again
                auth_url = _extract_auth_url_from_card(driver, codex_card)
                if auth_url: return auth_url
    except Exception as e:
        print(f"❌ Failed getting auth link: {e}")
    return None

def submit_callback_via_api(callback_url: str):
    print("\n📡 Submitting callback via API...")
    try:
        parsed = urlparse(callback_url)
        params = parse_qs(parsed.query)
        state = params.get("state", [None])[0]
        if not state: 
            print("✅ captured URL implies success (no state param found).")
            return True

        api_endpoint = f"{CLI_PROXY_API_BASE}/v0/management/oauth-callback"
        payload = {"provider": "codex", "redirect_url": callback_url, "state": state}
        headers = {"Content-Type": "application/json"}
        if CLI_PROXY_PASSWORD:
            headers["Authorization"] = f"Bearer {CLI_PROXY_PASSWORD}"
            headers["X-Management-Key"] = CLI_PROXY_PASSWORD

        res = http_session.post(api_endpoint, json=payload, headers=headers, timeout=30)
        if res.status_code == 200 and res.json().get("status") == "ok":
            print("✅ Callback submitted via API!")
            return True
        elif res.status_code == 404 and "expired" in res.text.lower():
            print("✅ CPA indicated state expired - Authentication likely already completed automatically!")
            return True
        else:
            print(f"❌ API Submit failed: Status {res.status_code}")
            print(f"   Response: {res.text[:200]}")
    except Exception as e:
        print(f"❌ API Submit failed with exception: {e}")
    return False

def perform_openai_oauth_login_in_new_window(driver, auth_link, email, password):
    print(f"\n🌐 Performing OAuth in new window: {auth_link[:60]}...")
    initial_handle = driver.current_window_handle
    
    # Open new tab
    driver.switch_to.new_window('tab')

def perform_openai_oauth_login_in_new_window(driver, auth_link, email, password):
    print(f"\n🌐 Performing OAuth in new window: {auth_link[:60]}...")
    initial_handle = driver.current_window_handle
    
    # Open new tab
    driver.switch_to.new_window('tab')
    login_handle = driver.current_window_handle
    driver.get(auth_link)
    
    # Check for inputs or direct redirect
    start_time = time.time()
    callback_url = None
    max_wait_time = 120  # Increased timeout to 120s
    
    print(f"   Waiting for callback (max {max_wait_time}s)...")
    
    last_print_time = 0
    while time.time() - start_time < max_wait_time:
        try:
            current_url = driver.current_url
            
            # Debug logging every 5 seconds
            if time.time() - last_print_time > 5:
                # print(f"   Current URL: {current_url[:80]}...")
                last_print_time = time.time()

            # 1. Success Check: Localhost callback or CPA Success Page
            if ("localhost" in current_url or "127.0.0.1" in current_url):
                # Check for explicit success in URL or validation code
                if "code=" in current_url:
                    print(f"✅ Captured callback URL (Auto-login): {current_url[:60]}...")
                    callback_url = current_url
                    break
                
                # Check page content for CPA success message
                try:
                    page_text = driver.find_element(By.TAG_NAME, "body").text
                    if "Authentication successful" in page_text or "Token saved" in page_text:
                        print("✅ Detected 'Authentication successful' message on page!")
                        callback_url = current_url # Return URL even if code missing, to signal success
                        break
                except: pass

            # 2. Email Input
            if driver.find_elements(By.CSS_SELECTOR, 'input[type="email"]'):
                print("📧 Email input detected...")
                email_input = driver.find_element(By.CSS_SELECTOR, 'input[type="email"]')
                email_input.clear()
                email_input.send_keys(email)
                
                # Try to find the submit/continue button specifically for email
                try:
                    btn = driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]')
                    driver.execute_script("arguments[0].click();", btn)
                except:
                    email_input.send_keys(Keys.ENTER)
                time.sleep(3)
            
            # 3. Password Input
            if driver.find_elements(By.CSS_SELECTOR, 'input[type="password"]'):
                print("🔑 Password input detected...")
                pwd_input = driver.find_element(By.CSS_SELECTOR, 'input[type="password"]')
                pwd_input.clear()
                pwd_input.send_keys(password)
                
                try:
                    btn = driver.find_element(By.CSS_SELECTOR, 'button[type="submit"]')
                    driver.execute_script("arguments[0].click();", btn)
                except:
                    pwd_input.send_keys(Keys.ENTER)
                time.sleep(3)
                
            # 4. Handle "Continue", "Authorize", "Allow" buttons (English & Chinese)
            btns = driver.find_elements(By.CSS_SELECTOR, 'button')
            keywords = [
                "continue", "authorize", "allow", "yes", "accept", "confirm",
                "继续", "授权", "允许", "确定", "确认", "接受"
            ]
            
            for btn in btns:
                if not btn.is_displayed(): continue
                text = btn.text.lower()
                if any(x in text for x in ["login", "sign up", "登录", "注册"]): continue
                
                if any(k in text for k in keywords):
                    print(f"🔘 Clicking button: {btn.text}")
                    try:
                        driver.execute_script("arguments[0].click();", btn)
                        time.sleep(2)
                    except Exception as e:
                        print(f"   Click error: {e}")
            
            # 5. Check for "Green" Authorize button specific to OAuth
            try:
                green_btns = driver.find_elements(By.CSS_SELECTOR, 'button[class*="btn-primary"], button[class*="yes"]')
                for btn in green_btns:
                    if btn.is_displayed() and "auth" in btn.text.lower():
                        driver.execute_script("arguments[0].click();", btn)
                        time.sleep(1)
            except: pass
            
        except Exception as e:
             pass
        
        time.sleep(1)
    
    try:
        driver.close()
        driver.switch_to.window(initial_handle)
    except:
        pass
        
    return callback_url

# ================= Main Flow =================

def check_and_handle_error(driver):
    # Simplified error handling
    try:
        body_text = driver.find_element(By.TAG_NAME, "body").text.lower()
        if "error" in body_text or "wrong" in body_text:
            # Try to find retry button
            btns = driver.find_elements(By.TAG_NAME, "button")
            for btn in btns:
                if "retry" in btn.text.lower() or "try again" in btn.text.lower():
                    btn.click()
                    time.sleep(3)
                    return True
    except: pass
    return False

def get_driver():
    options = uc.ChromeOptions()
    options.add_argument('--headless')
    options.add_argument('--no-sandbox')
    options.add_argument('--disable-dev-shm-usage')
    options.add_argument('--disable-gpu')
    options.add_argument('--window-size=1920,1080')
    options.add_argument('--user-agent=Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36')
    print("Initializing detected headless driver...")
    driver = uc.Chrome(options=options, use_subprocess=True)
    return driver

def register_and_feed_cpa():
    driver = get_driver()
    email = None
    password = None
    success = False

    try:
        # 1. Create Email
        email, cf_token = create_temp_email()
        if not email:
            print("❌ Failed to create email")
            return None, False

        # 2. Register on OpenAI
        password = generate_random_password()
        url = "https://chat.openai.com/chat"
        print(f"Navigating to {url}...")
        driver.get(url)
        time.sleep(3)
        # screenshot for debug
        driver.save_screenshot("debug_landing.png")
        
        wait = WebDriverWait(driver, 600)

        print("Waiting for signup button...")
        try:
            signup_button = wait.until(
                EC.element_to_be_clickable(
                    (By.CSS_SELECTOR, '[data-testid="signup-button"]')
                )
            )
            signup_button.click()
            print("Clicked signup button.")
        except Exception as e:
            print(f"⚠️ Signup button not found or clickable: {e}")
            driver.save_screenshot("debug_signup_error.png")
            raise e

        print("Waiting for email input...")
        email_inp = WebDriverWait(driver, 120).until(
            EC.visibility_of_element_located((By.ID, "email"))
        )
        email_inp.clear()
        email_inp.send_keys(email)
        print(f"Entered email: {email}")

        print("Clicking Continue button...")
        continue_btn = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[type="submit"]'))
        )
        continue_btn.click()
        print("Clicked Continue.")
        time.sleep(2)
        
        # Password
        print("Waiting for password input...")
        pwd_inp = WebDriverWait(driver, 120).until(
            EC.visibility_of_element_located((By.CSS_SELECTOR, 'input[autocomplete="new-password"]'))
        )
        pwd_inp.clear()
        time.sleep(0.5)
        for char in password:
            pwd_inp.send_keys(char)
            time.sleep(0.05)
        print("Entered password.")
        time.sleep(1)

        print("Clicking Continue button...")
        continue_btn = wait.until(
            EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[type="submit"]'))
        )
        driver.execute_script("arguments[0].click();", continue_btn)
        print("Clicked Continue.")
        
        # Wait for verify email
        verification_code = wait_for_verification_email(email, cf_token)
        if not verification_code:
            print("❌ Verification code not received")
            return email, False
        
        print(f"   Entering code {verification_code}...")
        code_inp = wait.until(EC.visibility_of_element_located((By.CSS_SELECTOR, 'input[name="code"]')))
        code_inp.send_keys(verification_code)
        time.sleep(1)

        print("Clicking Continue button...")
        for attempt in range(3):
            try:
                continue_btn = WebDriverWait(driver, 30).until(
                    EC.element_to_be_clickable(
                        (By.CSS_SELECTOR, 'button[type="submit"]')
                    )
                )
                driver.execute_script("arguments[0].click();", continue_btn)
                print("Clicked Continue.")
                break
            except Exception as e:
                print(f"  Attempt {attempt + 1} failed, retrying...")
                time.sleep(2)

        time.sleep(3)
        while check_and_handle_error(driver):
            time.sleep(2)
        
        # Onboarding (Name, Birthday)
        print("   Fill onboarding info...")
        try:
            print("Waiting for name input...")
            name_input = WebDriverWait(driver, 60).until(
                EC.visibility_of_element_located(
                    (By.CSS_SELECTOR, 'input[name="name"], input[autocomplete="name"]')
                )
            )
            name_input.clear()
            time.sleep(0.5)
            for char in "John Doe":
                name_input.send_keys(char)
                time.sleep(0.05)
            print("Entered name: John Doe")
            time.sleep(1)

            print("Entering birthday...")
            time.sleep(1)

            year_input = WebDriverWait(driver, 30).until(
                EC.presence_of_element_located((By.CSS_SELECTOR, '[data-type="year"]'))
            )
            driver.execute_script(
                "arguments[0].scrollIntoView({block: 'center'});", year_input
            )
            time.sleep(0.5)

            actions = ActionChains(driver)
            actions.click(year_input).perform()
            time.sleep(0.3)
            year_input.send_keys(Keys.CONTROL + "a")
            time.sleep(0.1)
            for char in "1990":
                year_input.send_keys(char)
                time.sleep(0.1)
            time.sleep(0.5)

            month_input = driver.find_element(By.CSS_SELECTOR, '[data-type="month"]')
            actions = ActionChains(driver)
            actions.click(month_input).perform()
            time.sleep(0.3)
            month_input.send_keys(Keys.CONTROL + "a")
            time.sleep(0.1)
            for char in "05":
                month_input.send_keys(char)
                time.sleep(0.1)
            time.sleep(0.5)

            day_input = driver.find_element(By.CSS_SELECTOR, '[data-type="day"]')
            actions = ActionChains(driver)
            actions.click(day_input).perform()
            time.sleep(0.3)
            day_input.send_keys(Keys.CONTROL + "a")
            time.sleep(0.1)
            for char in "12":
                day_input.send_keys(char)
                time.sleep(0.1)

            print("Entered birthday: 1990/05/12")
            time.sleep(1)

            print("Clicking final Continue button...")
            continue_btn = wait.until(
                EC.element_to_be_clickable((By.CSS_SELECTOR, 'button[type="submit"]'))
            )
            continue_btn.click()
            print("Clicked Continue.")
            
        except Exception as e:
           # Fallback mostly for debug, but try to continue
           print(f"⚠️ Onboarding specific error: {e}")
           
        # Try to reach Chat UI to confirm
        print("Waiting for registration to finalize...")
        time.sleep(5)
        
        # Save Account
        save_account(email, password)
        
        # 3. Feed to CPA
        print("\n🔗 Feeding to CPA...")
        auth_link = get_codex_oauth_auth_link(driver)
        if auth_link:
            # We use the existing driver session to authorize
            # This is critical: we must be logged in to OpenAI for this to work
            callback = perform_openai_oauth_login_in_new_window(driver, auth_link, email, password)
            if callback:
                if submit_callback_via_api(callback):
                    success = True
                    print("🎉 Account Registered and Linked to CPA!")
                else:
                    print("⚠️ Registered but failed to submit to CPA API")
            else:
                 print("⚠️ Registered but failed to get callback URL")
        else:
             print("⚠️ Registered but failed to get Auth Link from CPA")

    except Exception as e:
        print(f"❌ Error during process: {e}")
        # Save anyway if we have creds
        if email and password:
            save_account(email, password)
    finally:
        print("Closing browser...")
        try:
            driver.quit()
        except OSError:
            pass  # Suppress WinError 6
        except Exception as e:
            print(f"⚠️ Driver close error: {e}")
    
    return email, success

def run():
    print(f"🚀 Starting Headless CPA Feeder for {TOTAL_ACCOUNTS} accounts")
    for i in range(TOTAL_ACCOUNTS):
        print(f"\n--- Account {i+1}/{TOTAL_ACCOUNTS} ---")
        register_and_feed_cpa()
        time.sleep(5)

if __name__ == "__main__":
    run()
