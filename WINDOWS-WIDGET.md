# Windows 신호등 위젯

`iTicket Monitor Widget`은 브라우저와 별개로 실행되는 Windows용 서버 모니터입니다. 화면 오른쪽 위에 항상 표시되며 설정된 API를 직접 POST 호출합니다.

## 설치

1. [Windows 위젯 다운로드](https://lawcombo.github.io/iticket-monitor/download/iticket-monitor-widget-v1.0.1.zip)를 내려받습니다.
2. ZIP 파일의 압축을 해제합니다.
3. `install.cmd`를 더블클릭합니다.
4. 첫 실행 창에서 API Bearer 토큰을 입력합니다.
5. Windows SmartScreen 경고가 나타나면 파일 출처를 확인한 후 **추가 정보 → 실행**을 선택합니다.

관리자 권한은 필요하지 않습니다. 프로그램은 `%LOCALAPPDATA%\iticket-monitor`에 설치되며 현재 Windows 사용자 계정의 시작 프로그램에 등록됩니다.

## 사용법

- 위젯 클릭: 상세 GitHub Pages 화면 열기
- 위젯 드래그: 원하는 위치로 이동
- 위젯 우클릭: 즉시 점검, 서버별 ON/OFF, 점검 주기, 항상 위, 자동 실행, 종료
- 초록: 정상
- 주황: 지연 또는 이상 감지
- 빨강: 장애 확정
- 파랑: 점검 중
- 회색: 점검 전 또는 호출 서버 없음

설정과 마지막 위젯 위치는 `%LOCALAPPDATA%\iticket-monitor\widget.ini`에 저장됩니다. URL을 수정한 경우 프로그램을 종료한 뒤 다시 실행해야 합니다.

인증 토큰은 공개 ZIP이나 설정 파일에 포함하지 않습니다. 첫 실행 시 입력한 토큰은 Windows DPAPI로 암호화되어 `%LOCALAPPDATA%\iticket-monitor\authorization.dat`에 저장되며 같은 Windows 사용자만 해독할 수 있습니다. 위젯 우클릭 메뉴의 **인증 토큰 변경**에서 교체할 수 있습니다.

## 제거

다운로드한 폴더의 `uninstall.cmd`를 더블클릭합니다. 재설정을 위해 `widget.ini`는 남겨둡니다.

## 개발 빌드

Windows PowerShell에서 다음 명령을 실행합니다.

```powershell
powershell -ExecutionPolicy Bypass -File .\windows-app\build.ps1
```

Windows 기본 .NET Framework 컴파일러를 사용하므로 별도의 .NET SDK 설치가 필요하지 않습니다. 결과물은 `windows-app/dist`와 `download` 폴더에 생성됩니다.
