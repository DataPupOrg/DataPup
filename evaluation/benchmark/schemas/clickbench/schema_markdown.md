### Table: `hits`
Web analytics clickstream events from Yandex.Metrica (ClickBench benchmark). Single denormalized table with 105 columns covering page views, user demographics, search queries, ad clicks, and browser/OS metadata.
*Rows: ~99,997,497*

| Column | Type | Description |
| --- | --- | --- |
| `WatchID` | `UInt64` | Unique page view identifier |
| `JavaEnable` | `UInt8` | Whether Java is enabled (0/1) |
| `Title` | `String` | Page title |
| `GoodEvent` | `Int16` | Whether the event is valid (1=good, 0=bad) |
| `EventTime` | `DateTime` | Timestamp of the page view event |
| `EventDate` | `Date` | Date of the page view event |
| `CounterID` | `UInt32` | Yandex.Metrica counter/site identifier |
| `ClientIP` | `UInt32` | Client IP address as integer |
| `RegionID` | `UInt32` | Geographic region identifier |
| `UserID` | `UInt64` | Anonymous user identifier |
| `CounterClass` | `Int8` | Counter classification (0=general, 1=..., 2=...) |
| `OS` | `UInt8` | Operating system code |
| `UserAgent` | `UInt8` | User agent/browser type code |
| `URL` | `String` | Full page URL |
| `Referer` | `String` | Referrer URL |
| `IsRefresh` | `UInt8` | Whether this is a page refresh (0/1) |
| `RefererCategoryID` | `UInt16` | Category of the referrer |
| `RefererRegionID` | `UInt32` | Region of the referrer |
| `URLCategoryID` | `UInt16` | Category of the visited URL |
| `URLRegionID` | `UInt32` | Region of the visited URL |
| `ResolutionWidth` | `UInt16` | Screen resolution width in pixels |
| `ResolutionHeight` | `UInt16` | Screen resolution height in pixels |
| `ResolutionDepth` | `UInt8` | Color depth in bits |
| `FlashMajor` | `UInt8` | Flash plugin major version |
| `FlashMinor` | `UInt8` | Flash plugin minor version |
| `FlashMinor2` | `String` | Flash plugin detailed version string |
| `NetMajor` | `UInt8` | .NET framework major version |
| `NetMinor` | `UInt8` | .NET framework minor version |
| `UserAgentMajor` | `UInt16` | Browser major version |
| `UserAgentMinor` | `FixedString(2)` | Browser minor version |
| `CookieEnable` | `UInt8` | Whether cookies are enabled (0/1) |
| `JavascriptEnable` | `UInt8` | Whether JavaScript is enabled (0/1) |
| `IsMobile` | `UInt8` | Whether the device is mobile (0/1) |
| `MobilePhone` | `UInt8` | Mobile phone model code |
| `MobilePhoneModel` | `String` | Mobile phone model name |
| `Params` | `String` | URL parameters |
| `IPNetworkID` | `UInt32` | IP network identifier |
| `TraficSourceID` | `Int8` | Traffic source type (-1=internal, 0=direct, 1=search, 2=ad, 3=referral, etc.) |
| `SearchEngineID` | `UInt16` | Search engine identifier |
| `SearchPhrase` | `String` | Search query phrase |
| `AdvEngineID` | `UInt8` | Advertising engine identifier |
| `IsArtifical` | `UInt8` | Whether the hit is artificial/synthetic (0/1) |
| `WindowClientWidth` | `UInt16` | Browser window width |
| `WindowClientHeight` | `UInt16` | Browser window height |
| `ClientTimeZone` | `Int16` | Client timezone offset in minutes |
| `ClientEventTime` | `DateTime` | Event time in client timezone |
| `SilverlightVersion1` | `UInt8` | Silverlight major version |
| `SilverlightVersion2` | `UInt8` | Silverlight minor version |
| `SilverlightVersion3` | `UInt32` | Silverlight build version |
| `SilverlightVersion4` | `UInt16` | Silverlight revision |
| `PageCharset` | `String` | Page character encoding |
| `CodeVersion` | `UInt32` | Tracking code version |
| `IsLink` | `UInt8` | Whether this is a link click event (0/1) |
| `IsDownload` | `UInt8` | Whether this is a file download event (0/1) |
| `IsNotBounce` | `UInt8` | Whether the visit had more than one page view (0/1) |
| `FUniqID` | `UInt64` | Unique fingerprint identifier |
| `OriginalURL` | `String` | Original (unprocessed) URL |
| `HID` | `UInt32` | Hit identifier within session |
| `IsOldCounter` | `UInt8` | Whether using legacy counter code (0/1) |
| `IsEvent` | `UInt8` | Whether this is a custom event (0/1) |
| `IsParameter` | `UInt8` | Whether this hit has custom parameters (0/1) |
| `DontCountHits` | `UInt8` | Whether to exclude from hit count (0/1) |
| `WithHash` | `UInt8` | Whether URL contains hash fragment (0/1) |
| `HitColor` | `FixedString(1)` | Hit color classification code |
| `LocalEventTime` | `DateTime` | Event time in local timezone |
| `Age` | `UInt8` | User age bucket |
| `Sex` | `UInt8` | User gender (0=unknown, 1=male, 2=female) |
| `Income` | `UInt8` | User income bracket |
| `Interests` | `UInt16` | User interest category |
| `Robotness` | `UInt8` | Bot probability score |
| `RemoteIP` | `UInt32` | Remote IP address (proxy-resolved) |
| `WindowName` | `Int32` | Browser window name hash |
| `OpenerName` | `Int32` | Opener window name hash |
| `HistoryLength` | `Int16` | Browser history length |
| `BrowserLanguage` | `FixedString(2)` | Browser language code |
| `BrowserCountry` | `FixedString(2)` | Browser country code |
| `SocialNetwork` | `String` | Social network name if referrer is social |
| `SocialAction` | `String` | Social action type |
| `HTTPError` | `UInt16` | HTTP error code (0 if none) |
| `SendTiming` | `Int32` | Time to send request (ms) |
| `DNSTiming` | `Int32` | DNS resolution time (ms) |
| `ConnectTiming` | `Int32` | TCP connection time (ms) |
| `ResponseStartTiming` | `Int32` | Time to first byte (ms) |
| `ResponseEndTiming` | `Int32` | Time to last byte (ms) |
| `FetchTiming` | `Int32` | Total fetch time (ms) |
| `SocialSourceNetworkID` | `UInt8` | Social source network ID |
| `SocialSourcePage` | `String` | Social source page URL |
| `ParamPrice` | `Int64` | Product price parameter |
| `ParamOrderID` | `String` | Order ID parameter |
| `ParamCurrency` | `FixedString(3)` | Currency code parameter |
| `ParamCurrencyID` | `UInt16` | Currency identifier |
| `OpenstatServiceName` | `String` | Openstat service name |
| `OpenstatCampaignID` | `String` | Openstat campaign ID |
| `OpenstatAdID` | `String` | Openstat ad ID |
| `OpenstatSourceID` | `String` | Openstat source ID |
| `UTMSource` | `String` | UTM source parameter |
| `UTMMedium` | `String` | UTM medium parameter |
| `UTMCampaign` | `String` | UTM campaign parameter |
| `UTMContent` | `String` | UTM content parameter |
| `UTMTerm` | `String` | UTM term parameter |
| `FromTag` | `String` | Custom from tag |
| `HasGCLID` | `UInt8` | Whether URL has Google Click ID (0/1) |
| `RefererHash` | `UInt64` | Hash of the referrer URL |
| `URLHash` | `UInt64` | Hash of the page URL |
| `CLID` | `UInt32` | Click identifier |

**Engine:** MergeTree
**ORDER BY:** (CounterID, EventDate, intHash32(UserID))
**SAMPLE BY:** intHash32(UserID)

**No relationships** — this is a single denormalized table.
