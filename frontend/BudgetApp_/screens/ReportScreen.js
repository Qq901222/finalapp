// screens/ReportScreen.js
import { MaterialCommunityIcons } from '@expo/vector-icons'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { Picker } from '@react-native-picker/picker'
import { useFocusEffect, useNavigation } from '@react-navigation/native'
import * as Print from 'expo-print'
import * as Sharing from 'expo-sharing'
import { useCallback, useMemo, useRef, useState } from 'react'
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native'
import { getTransactions } from '../lib/api'

let VictoryChart = null
let VictoryAxis = null
let VictoryLine = null
let VictoryLegend = null
try {
  const v = require('victory-native')
  VictoryChart = v.VictoryChart
  VictoryAxis = v.VictoryAxis
  VictoryLine = v.VictoryLine
  VictoryLegend = v.VictoryLegend
} catch {}

const currency = (n) =>
  `${n < 0 ? '-' : ''}NT$${Math.abs(Number(n || 0)).toLocaleString()}`

const EXPENSE_CATEGORIES = [
  { key: '晚餐', icon: 'silverware-fork-knife', color: '#F2C94C' },
  { key: '午餐', icon: 'silverware-fork-knife', color: '#F2C94C' },
  { key: '點心', icon: 'cupcake', color: '#F2994A' },
  { key: '購物', icon: 'shopping', color: '#B39DDB' },

  { key: '交通', icon: 'bus', color: '#6CB6FF' },
  { key: '飲品', icon: 'coffee', color: '#87CBB9' },
  { key: '早餐', icon: 'bread-slice', color: '#F2C94C' },
  { key: '洗衣服', icon: 'tshirt-crew-outline', color: '#9E9E9E' },

  { key: '娛樂', icon: 'gamepad-variant', color: '#F9A825' },
  { key: '日用品', icon: 'cart-outline', color: '#8D6E63' },
  { key: '書費', icon: 'book-open-variant', color: '#90CAF9' },
  { key: '社交', icon: 'account-group', color: '#4DB6AC' },

  { key: '水電費', icon: 'water', color: '#64B5F6' },
  { key: '學費', icon: 'school-outline', color: '#7986CB' },
  { key: '房租', icon: 'home-city-outline', color: '#AED581' },

  { key: '直播', icon: 'cellphone-play', color: '#90CAF9' },
  { key: '機車', icon: 'motorbike', color: '#B0BEC5' },
  { key: '信用卡', icon: 'credit-card-outline', color: '#90A4AE' },
  { key: '酒類', icon: 'glass-cocktail', color: '#CE93D8' },

  { key: '醫療', icon: 'medical-bag', color: '#EF9A9A' },
  { key: '禮物', icon: 'gift-outline', color: '#FFCC80' },
  { key: '其他', icon: 'dots-horizontal-circle-outline', color: '#BDBDBD' },
]

const INCOME_CATEGORIES = [
  { key: '零用錢', icon: 'sack', color: '#90CAF9' },
  { key: '薪水', icon: 'wallet-outline', color: '#6CB6FF' },
  { key: '回饋', icon: 'cash-refund', color: '#87CBB9' },
  { key: '交易', icon: 'swap-horizontal', color: '#B0BEC5' },

  { key: '獎金', icon: 'gift-outline', color: '#FFD54F' },
  { key: '股息', icon: 'chart-line', color: '#AED581' },
  { key: '投資', icon: 'finance', color: '#81C784' },
  { key: '其他', icon: 'dots-horizontal-circle-outline', color: '#BDBDBD' },

  { key: '租金', icon: 'home-currency-usd', color: '#FFCC80' },
]

const ALL_CATEGORIES = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]

function clamp(n, a, b) {
  return Math.max(a, Math.min(b, n))
}

function startEndOfYear(year) {
  const start = new Date(year, 0, 1, 0, 0, 0, 0)
  const end = new Date(year, 11, 31, 23, 59, 59, 999)
  return { start, end }
}

function pickIcon(category) {
  const hit = ALL_CATEGORIES.find((c) => c.key === category)
  return hit || { key: category, icon: 'tag-outline', color: '#BDBDBD' }
}

function monthLabel(year, monthIndex0) {
  return `${year}年 ${monthIndex0 + 1}月`
}

function niceYDomain(max) {
  const m = Math.max(0, Number(max || 0))
  let step = 500
  if (m > 20000) step = 10000
  else if (m > 5000) step = 5000
  else if (m > 1000) step = 1000
  const top = Math.ceil(m / step) * step || step
  return [0, top]
}

export default function ReportScreen() {
  const navigation = useNavigation()
  const now = new Date()

  const [year, setYear] = useState(now.getFullYear())
  const [selectedMonth, setSelectedMonth] = useState(now.getMonth())
  const [income, setIncome] = useState(0)
  const [expense, setExpense] = useState(0)
  const [transactions, setTransactions] = useState([])
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [genLoading, setGenLoading] = useState(false)

  const [filterOpen, setFilterOpen] = useState(false)
  const [filterTab, setFilterTab] = useState('category')
  const [catMode, setCatMode] = useState('expense') // expense / income
  const [selectedCategories, setSelectedCategories] = useState([])
  const [selectedItems, setSelectedItems] = useState([])
  const [itemQuery, setItemQuery] = useState('')

  const [yearPickerOpen, setYearPickerOpen] = useState(false)
  const [tmpYear, setTmpYear] = useState(year)
  const yearConfirmRef = useRef(year)

  const monthTitle = useMemo(
    () => monthLabel(year, clamp(selectedMonth, 0, 11)),
    [year, selectedMonth]
  )

  const net = income - expense

  const loadData = useCallback(async () => {
    setLoading(true)
    try {
      const { start, end } = startEndOfYear(year)
      const tx = await getTransactions({
        page: 1,
        limit: 5000,
        startDate: start.toISOString(),
        endDate: end.toISOString(),
      })
      const authRaw = await AsyncStorage.getItem('auth')
      const currentUserId = authRaw ? JSON.parse(authRaw)?.user?.id : null

      const apiRows = Array.isArray(tx?.records)
        ? tx.records
        : Array.isArray(tx?.items)
        ? tx.items
        : []

      const safeRows = apiRows
        .filter((r) => {
          if (!currentUserId) return true
          const ownerId = r?.userId ?? r?.user?.id
          return Number(ownerId) === Number(currentUserId)
        })
        .map((r) => ({
          ...r,
          date: r.createdAt ?? r.date ?? r.time ?? null,
        }))

      setTransactions(safeRows)


      const m = clamp(selectedMonth, 0, 11)
      let monthIncome = 0
      let monthExpense = 0

      for (const t of items) {
        const d = new Date(t.createdAt || t.date)
        if (Number.isNaN(d.getTime())) continue
        if (d.getFullYear() !== year) continue
        if (d.getMonth() !== m) continue
        const amt = Number(t.amount || 0)
        if (amt > 0) monthExpense += amt
        else if (amt < 0) monthIncome += Math.abs(amt)
      }

      setIncome(monthIncome)
      setExpense(monthExpense)
    } finally {
      setLoading(false)
    }
  }, [year, selectedMonth])

  useFocusEffect(
    useCallback(() => {
      loadData()
    }, [loadData])
  )

  const onRefresh = async () => {
    setRefreshing(true)
    await loadData()
    setRefreshing(false)
  }

  const monthInfo = useMemo(() => {
    const m = clamp(selectedMonth, 0, 11)
    const prevM = m - 1

    const monthTx = (mi) => {
      if (mi < 0) return []
      return transactions.filter((t) => {
        const d = new Date(t.createdAt || t.date)
        return d.getFullYear() === year && d.getMonth() === mi
      })
    }

    const cur = monthTx(m).filter((t) => Number(t.amount || 0) > 0)
    const prev = monthTx(prevM).filter((t) => Number(t.amount || 0) > 0)

    const byCat = (list) => {
      const map = new Map()
      for (const t of list) {
        const cat = String(t.category || '其他')
        const v = Number(t.amount || 0)
        map.set(cat, (map.get(cat) || 0) + v)
      }
      return map
    }

    const curMap = byCat(cur)
    const prevMap = byCat(prev)

    const cats = new Set([...curMap.keys(), ...prevMap.keys()])
    let best = null

    for (const c of cats) {
      const curV = curMap.get(c) || 0
      const prevV = prevMap.get(c) || 0
      if (curV <= 0 && prevV <= 0) continue

      const delta = curV - prevV
      const denom = prevV > 0 ? prevV : 0
      const pct = denom > 0 ? (delta / denom) * 100 : curV > 0 ? 100 : 0

      const score = Math.abs(pct) * 1000 + Math.abs(delta)
      if (!best || score > best.score) {
        best = { category: c, curV, delta, pct, score }
      }
    }

    if (!best) {
      return { empty: true, category: '晚餐', curV: 0, delta: 0, pct: 0 }
    }

    return { empty: false, ...best }
  }, [transactions, year, selectedMonth])

  const monthInfoUi = useMemo(() => {
    const icon = pickIcon(monthInfo.category)
    const isUp = monthInfo.delta >= 0
    const pctAbs = Math.abs(monthInfo.pct || 0)
    const pctText = monthInfo.empty ? '—' : `${pctAbs >= 1000 ? '999+' : Math.round(pctAbs)}%`

    return {
      icon,
      isUp,
      pctText,
      title: monthInfo.category,
      amount: currency(monthInfo.curV),
      hint:'本月支出總額最多',
    }
  }, [monthInfo])

  const itemAllOptions = useMemo(() => {
    const set = new Set()
    for (const t of transactions) {
      const d = new Date(t.createdAt || t.date)
      if (d.getFullYear() !== year) continue
      const note = String(t.note || '').trim()
      if (note) set.add(note)
    }
    const all = Array.from(set)
    all.sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    return all
  }, [transactions, year])


  const itemOptions = useMemo(() => {
    const set = new Set()
    for (const t of transactions) {
      const d = new Date(t.createdAt || t.date)
      if (d.getFullYear() !== year) continue
      const note = String(t.note || '').trim()
      if (note) set.add(note)
    }
    const all = Array.from(set)
    all.sort((a, b) => a.localeCompare(b, 'zh-Hant'))
    if (!itemQuery.trim()) return all.slice(0, 120)
    const q = itemQuery.trim().toLowerCase()
    return all.filter((s) => s.toLowerCase().includes(q)).slice(0, 120)
  }, [transactions, year, itemQuery])

  const toggleInList = (arr, val) => {
    const set = new Set(arr)
    if (set.has(val)) set.delete(val)
    else set.add(val)
    return Array.from(set)
  }

  const isIncomeCategory = useCallback((cat) => {
    return INCOME_CATEGORIES.some((c) => c.key === cat)
  }, [])

  const seriesAllExpense = useMemo(() => {
    const months = Array.from({ length: 12 }).map((_, i) => ({ x: `${i + 1}月`, __m: i, value: 0 }))
    const itemSet = new Set(selectedItems)

    for (const t of transactions) {
      const d = new Date(t.createdAt || t.date)
      if (d.getFullYear() !== year) continue
      const m = d.getMonth()
      const amt = Number(t.amount || 0)
      if (!(amt > 0)) continue

      const note = String(t.note || '')
      const passItem = itemSet.size === 0 ? true : itemSet.has(note)
      if (!passItem) continue

      months[m].value += amt
    }
    return months
  }, [transactions, year, selectedItems])

  const pinnedSeries = useMemo(() => {
    const itemSet = new Set(selectedItems)
    const catSet = new Set(selectedCategories)

    const makeEmpty = () =>
      Array.from({ length: 12 }).map((_, i) => ({
        x: `${i + 1}月`,
        __m: i,
        value: 0,
      }))

    const map = new Map()
    for (const c of catSet) map.set(c, makeEmpty())

    for (const t of transactions) {
      const d = new Date(t.createdAt || t.date)
      if (d.getFullYear() !== year) continue
      const m = d.getMonth()
      const amt = Number(t.amount || 0)

      const cat = String(t.category || '其他')
      if (!catSet.has(cat)) continue

      const note = String(t.note || '')
      const passItem = itemSet.size === 0 ? true : itemSet.has(note)
      if (!passItem) continue

      const isInc = isIncomeCategory(cat)
      if (isInc) {
        if (!(amt < 0)) continue
        map.get(cat)[m].value += Math.abs(amt)
      } else {
        if (!(amt > 0)) continue
        map.get(cat)[m].value += amt
      }
    }

    return map
  }, [transactions, year, selectedCategories, selectedItems, isIncomeCategory])

  const hasAll = useMemo(() => seriesAllExpense.some((m) => m.value > 0), [seriesAllExpense])
  const yDomainAll = useMemo(() => {
    const max = Math.max(...seriesAllExpense.map((m) => m.value), 0)
    return niceYDomain(max)
  }, [seriesAllExpense])

  const pinnedList = useMemo(() => {
    const uniq = Array.from(new Set(selectedCategories))
    return uniq
  }, [selectedCategories])

  const yDomainOf = (series) => {
    const max = Math.max(...series.map((m) => m.value), 0)
    return niceYDomain(max)
  }

  const generatePdf = async () => {
    try {
      setGenLoading(true)

      const rowsAll = seriesAllExpense
        .map(
          (m) => `
          <tr>
            <td>${m.x}</td>
            <td>${currency(m.value)}</td>
          </tr>
        `
        )
        .join('')

      const pinnedBlocks = pinnedList
        .map((cat) => {
          const s = pinnedSeries.get(cat) || []
          const rows = s
            .map(
              (m) => `
              <tr>
                <td>${m.x}</td>
                <td>${currency(m.value)}</td>
              </tr>
            `
            )
            .join('')
          return `
            <h3>${cat}</h3>
            <table border="1" cellpadding="6" cellspacing="0">
              <tr><th>月份</th><th>金額</th></tr>
              ${rows}
            </table>
          `
        })
        .join('')

      const html = `
        <h1>財務分析報表</h1>
        <p>年度：${year}</p>
        <p>本月（${monthTitle}）收入：${currency(income)}</p>
        <p>本月（${monthTitle}）支出：${currency(expense)}</p>
        <p>本月（${monthTitle}）結餘：${currency(net)}</p>

        <h2>${year} 年支出趨勢（所有分類）</h2>
        ${
          hasAll
            ? `
          <table border="1" cellpadding="6" cellspacing="0">
            <tr><th>月份</th><th>支出</th></tr>
            ${rowsAll}
          </table>
          `
            : `<p>無資料</p>`
        }

        ${pinnedBlocks ? `<h2>釘選分類</h2>${pinnedBlocks}` : ''}
      `

      const { uri } = await Print.printToFileAsync({ html })
      await Sharing.shareAsync(uri)
    } catch {
      Alert.alert('PDF 產生失敗')
    } finally {
      setGenLoading(false)
    }
  }

  return (
    <View style={styles.page}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.headerIcon} onPress={() => navigation.goBack()}>
          <MaterialCommunityIcons name="close" size={22} color="#FFF" />
        </TouchableOpacity>

        <Text style={styles.headerTitle}>趨勢變化</Text>

        <View style={styles.headerFox}>
          <View style={styles.foxCircle} />
          <View style={styles.foxSilhouette} />
        </View>
      </View>

      <View style={styles.yearRow}>
        <TouchableOpacity
          style={styles.yearBtn}
          onPress={() => {
            yearConfirmRef.current = year
            setTmpYear(year)
            setYearPickerOpen(true)
          }}
        >
          <Text style={styles.yearText}>{year}</Text>
          <MaterialCommunityIcons name="chevron-down" size={18} color="#FFF" />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ paddingBottom: 24 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      >
        

        <View style={styles.monthInfoCard}>
          <View style={styles.monthInfoLeft}>
            <View style={[styles.catDot, { backgroundColor: monthInfoUi.icon.color }]}>
              <MaterialCommunityIcons name={monthInfoUi.icon.icon} size={18} color="#FFF" />
            </View>

            <View style={{ flex: 1 }}>
              <View style={styles.monthInfoTopRow}>
                <Text style={styles.monthInfoCat}>{monthInfoUi.title}</Text>
                <Text style={styles.monthInfoAmt}>{monthInfoUi.amount}</Text>

                <View style={styles.deltaWrap}>
                  <MaterialCommunityIcons
                    name={monthInfoUi.isUp ? 'arrow-up' : 'arrow-down'}
                    size={14}
                    color={monthInfoUi.isUp ? '#F25C5C' : '#2F80ED'}
                  />
                  <Text style={[styles.deltaText, { color: monthInfoUi.isUp ? '#F25C5C' : '#2F80ED' }]}>
                    {monthInfoUi.pctText}
                  </Text>
                </View>
              </View>

              <Text style={styles.monthInfoHint}>{monthInfoUi.hint}</Text>
            </View>
          </View>

          
        </View>

       

        <TouchableOpacity style={styles.filterRow} onPress={() => setFilterOpen(true)}>
          <View style={styles.radioDot} />
          <Text style={styles.filterText}>
            {selectedCategories.length ? selectedCategories[0] : '所有分類'}
          </Text>
          <View style={{ flex: 1 }} />
          <MaterialCommunityIcons name="chevron-right" size={22} color="#BDBDBD" />
        </TouchableOpacity>

        {/* 所有分類：永遠顯示 */}
        <View style={styles.chartBlock}>
          <View style={styles.chartTitleRow}>
            <Text style={styles.chartTitleText}>所有分類</Text>
            <Text style={styles.chartSubText}>（支出）</Text>
          </View>

          <View style={styles.chartCard}>
            {!VictoryChart ? (
              <View style={styles.emptyChart}>
                <Text style={styles.emptyBig}>無資料</Text>
                <Text style={styles.emptySub}>（Victory 沒載入，先讓它休息一下）</Text>
                <View style={styles.monthTicks}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Text key={String(i)} style={styles.monthTick}>
                      {i + 1}月
                    </Text>
                  ))}
                </View>
              </View>
            ) : !hasAll ? (
              <View style={styles.emptyChart}>
                <Text style={styles.emptyBig}>無資料</Text>
                <View style={styles.monthTicks}>
                  {Array.from({ length: 12 }).map((_, i) => (
                    <Text key={String(i)} style={styles.monthTick}>
                      {i + 1}月
                    </Text>
                  ))}
                </View>
              </View>
            ) : (
              <VictoryChart
                height={240}
                padding={{ top: 34, left: 56, right: 24, bottom: 42 }}
                domainPadding={{ y: 18, x: 10 }}
              >
                <VictoryLegend
                  x={56}
                  y={4}
                  orientation="horizontal"
                  gutter={18}
                  data={[{ name: '支出', symbol: { fill: '#EB5757' } }]}
                />

                <VictoryAxis
                  tickValues={Array.from({ length: 12 }).map((_, i) => `${i + 1}月`)}
                  style={{
                    tickLabels: { fontSize: 10, padding: 6 },
                    axis: { stroke: '#E0E0E0' },
                    grid: { stroke: 'transparent' },
                  }}
                />
                <VictoryAxis
                  dependentAxis
                  domain={yDomainAll}
                  tickFormat={(t) => `NT$${t}`}
                  style={{
                    tickLabels: { fontSize: 10, padding: 6 },
                    axis: { stroke: '#E0E0E0' },
                    grid: { stroke: '#F0F0F0' },
                  }}
                />

                <VictoryLine
                  data={seriesAllExpense}
                  x="x"
                  y="value"
                  style={{ data: { stroke: '#EB5757', strokeWidth: 2 } }}
                  events={[
                    {
                      target: 'data',
                      eventHandlers: {
                        onPressIn: (_, props) => {
                          const m = Number(props?.datum?.__m)
                          if (!Number.isNaN(m)) setSelectedMonth(clamp(m, 0, 11))
                        },
                      },
                    },
                  ]}
                />
              </VictoryChart>
            )}
          </View>
        </View>

        {/* 釘選分類：逐一顯示 */}
        {pinnedList.map((cat) => {
          const icon = pickIcon(cat)
          const series = pinnedSeries.get(cat) || []
          const has = series.some((m) => m.value > 0)
          const yDomain = yDomainOf(series)
          const isInc = isIncomeCategory(cat)
          const color = isInc ? '#2F80ED' : '#EB5757'

          return (
            <View key={cat} style={styles.chartBlock}>
              <View style={styles.chartTitleRow}>
                <View style={[styles.smallDot, { backgroundColor: icon.color }]}>
                  <MaterialCommunityIcons name={icon.icon} size={16} color="#FFF" />
                </View>
                <Text style={styles.chartTitleText}>{cat}</Text>
                <Text style={styles.chartSubText}>{isInc ? '（收入）' : '（支出）'}</Text>

                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  onPress={() => setSelectedCategories((v) => v.filter((x) => x !== cat))}
                  style={styles.removePill}
                >
                  <MaterialCommunityIcons name="minus" size={16} color="#9E9E9E" />
                </TouchableOpacity>
              </View>

              <View style={styles.chartCard}>
                {!VictoryChart ? (
                  <View style={styles.emptyChart}>
                    <Text style={styles.emptyBig}>無資料</Text>
                    <Text style={styles.emptySub}>（Victory 沒載入，先讓它休息一下）</Text>
                  </View>
                ) : !has ? (
                  <View style={styles.emptyChart}>
                    <Text style={styles.emptyBig}>無資料</Text>
                  </View>
                ) : (
                  <VictoryChart
                    height={240}
                    padding={{ top: 34, left: 56, right: 24, bottom: 42 }}
                    domainPadding={{ y: 18, x: 10 }}
                  >
                    <VictoryLegend
                      x={56}
                      y={4}
                      orientation="horizontal"
                      gutter={18}
                      data={[{ name: isInc ? '收入' : '支出', symbol: { fill: color } }]}
                    />

                    <VictoryAxis
                      tickValues={Array.from({ length: 12 }).map((_, i) => `${i + 1}月`)}
                      style={{
                        tickLabels: { fontSize: 10, padding: 6 },
                        axis: { stroke: '#E0E0E0' },
                        grid: { stroke: 'transparent' },
                      }}
                    />
                    <VictoryAxis
                      dependentAxis
                      domain={yDomain}
                      tickFormat={(t) => `NT$${t}`}
                      style={{
                        tickLabels: { fontSize: 10, padding: 6 },
                        axis: { stroke: '#E0E0E0' },
                        grid: { stroke: '#F0F0F0' },
                      }}
                    />

                    <VictoryLine
                      data={series}
                      x="x"
                      y="value"
                      style={{ data: { stroke: color, strokeWidth: 2 } }}
                      events={[
                        {
                          target: 'data',
                          eventHandlers: {
                            onPressIn: (_, props) => {
                              const m = Number(props?.datum?.__m)
                              if (!Number.isNaN(m)) setSelectedMonth(clamp(m, 0, 11))
                            },
                          },
                        },
                      ]}
                    />
                  </VictoryChart>
                )}
              </View>
            </View>
          )
        })}

        

        <View style={styles.pdfCard}>
          <TouchableOpacity style={styles.pdfBtn} onPress={generatePdf} disabled={genLoading}>
            <MaterialCommunityIcons name="file-pdf-box" size={20} color="#FFF" />
            <Text style={styles.pdfBtnText}>{genLoading ? '產生中…' : '產生 PDF'}</Text>
          </TouchableOpacity>
        </View>
      </ScrollView>

      {/* 分類 / 項目 Modal */}
      <Modal visible={filterOpen} transparent animationType="fade" onRequestClose={() => setFilterOpen(false)}>
        <Pressable style={styles.modalMask} onPress={() => setFilterOpen(false)} />
        <View style={styles.modalSheet}>
          <View style={styles.modalTop}>
          {/* 左上：全部項目 / 所有分類 */}
          <TouchableOpacity
            style={styles.allBtn}
            onPress={() => {
              if (filterTab === 'category') {
                setSelectedCategories([]) // 所有分類
                return
              }

              // item tab：全選 / 全取消
              if (itemAllOptions.length === 0) return

              const allSelected =
                selectedItems.length > 0 && selectedItems.length === itemAllOptions.length

              setSelectedItems(allSelected ? [] : itemAllOptions)
            }}
            activeOpacity={0.85}
          >

            <Text style={styles.allBtnText}>
              {filterTab === 'category'
                ? '所有分類'
                : (selectedItems.length > 0 && selectedItems.length === itemAllOptions.length ? '全取消' : '全選')}
            </Text>

          </TouchableOpacity>

          <View style={styles.tabRow}>
            <TouchableOpacity
              style={[styles.tabBtn, filterTab === 'category' && styles.tabBtnActive]}
              onPress={() => setFilterTab('category')}
            >
              <Text style={[styles.tabText, filterTab === 'category' && styles.tabTextActive]}>
                分類
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.tabBtn, filterTab === 'item' && styles.tabBtnActive]}
              onPress={() => setFilterTab('item')}
            >
              <Text style={[styles.tabText, filterTab === 'item' && styles.tabTextActive]}>
                項目名稱
              </Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity style={styles.checkBtn} onPress={() => setFilterOpen(false)}>
            <MaterialCommunityIcons name="check" size={22} color="#BDBDBD" />
          </TouchableOpacity>
        </View>


          {filterTab === 'category' ? (
            <>
              <Text style={styles.modalHint}>選擇一個或多個分類來查看報表</Text>

              <View style={styles.modeRow}>
                <TouchableOpacity
                  style={[styles.modeBtn, catMode === 'expense' && styles.modeBtnOn]}
                  onPress={() => setCatMode('expense')}
                >
                  <Text style={[styles.modeText, catMode === 'expense' && styles.modeTextOn]}>支出</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.modeBtn, catMode === 'income' && styles.modeBtnOn]}
                  onPress={() => setCatMode('income')}
                >
                  <Text style={[styles.modeText, catMode === 'income' && styles.modeTextOn]}>收入</Text>
                </TouchableOpacity>
              </View>

              <View style={styles.catGrid}>
                {(catMode === 'expense' ? EXPENSE_CATEGORIES : INCOME_CATEGORIES).map((c) => {
                  const selected = selectedCategories.includes(c.key)
                  return (
                    <TouchableOpacity
                      key={c.key}
                      style={styles.catCell}
                      onPress={() =>
                                setSelectedCategories((v) => (v?.[0] === c.key ? [] : [c.key]))
                              }

                    >
                      <MaterialCommunityIcons name={c.icon} size={28} color={selected ? c.color : '#CFCFCF'} />
                      <Text style={[styles.catText, selected && { color: c.color, fontWeight: '800' }]}>{c.key}</Text>
                    </TouchableOpacity>
                  )
                })}
              </View>

            
            </>
          ) : (
            <>
              <Text style={styles.modalHint}>選擇要追蹤的項目（用備註/品項名稱）</Text>

              <View style={styles.searchRow}>
                <MaterialCommunityIcons name="magnify" size={18} color="#BDBDBD" />
                <TextInput
                  value={itemQuery}
                  onChangeText={setItemQuery}
                  placeholder="搜尋項目名稱"
                  placeholderTextColor="#BDBDBD"
                  style={styles.searchInput}
                />
                {!!itemQuery && (
                  <TouchableOpacity onPress={() => setItemQuery('')}>
                    <MaterialCommunityIcons name="close-circle" size={18} color="#BDBDBD" />
                  </TouchableOpacity>
                )}
              </View>

              <ScrollView style={{ maxHeight: 300 }}>
                {itemOptions.length === 0 ? (
                  <View style={{ paddingVertical: 18 }}>
                    <Text style={{ color: '#B0B0B0', textAlign: 'center' }}>這一年還沒有可選的項目</Text>
                  </View>
                ) : (
                  itemOptions.map((name) => {
                    const selected = selectedItems.includes(name)
                    return (
                      <TouchableOpacity
                        key={name}
                        style={styles.itemRow}
                        onPress={() => setSelectedItems((v) => toggleInList(v, name))}
                      >
                        <View style={[styles.itemCheck, selected && styles.itemCheckOn]}>
                          {selected ? <MaterialCommunityIcons name="check" size={14} color="#FFF" /> : null}
                        </View>
                        <Text style={styles.itemText} numberOfLines={1}>
                          {name}
                        </Text>
                      </TouchableOpacity>
                    )
                  })
                )}
              </ScrollView>

              
            </>
          )}
        </View>
      </Modal>

      {/* ===== 年份選擇 Modal（放這裡：filter modal 後面、loadingFloat 前面）===== */}
      <Modal
        visible={yearPickerOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setYearPickerOpen(false)}
      >
        <Pressable style={styles.yearMask} onPress={() => setYearPickerOpen(false)} />
        <View style={styles.yearSheet}>
          <View style={styles.yearTopRow}>
            <View style={{ width: 40 }} />
            <Text style={styles.yearTitle}>選擇年度</Text>
            <TouchableOpacity style={styles.yearClose} onPress={() => setYearPickerOpen(false)}>
              <MaterialCommunityIcons name="close" size={22} color="#B0B0B0" />
            </TouchableOpacity>
          </View>

          <View style={styles.pickerWrap}>
            <Picker selectedValue={tmpYear} onValueChange={(v) => setTmpYear(Number(v))} itemStyle={styles.pickerItem}>
              {Array.from({ length: 6 }).map((_, i) => {
                const y = now.getFullYear() + 1 - i
                return <Picker.Item key={String(y)} label={`${y} 年`} value={y} />
              })}
              {Array.from({ length: 6 }).map((_, i) => {
                const y = now.getFullYear() - 1 - i
                return <Picker.Item key={String(y)} label={`${y} 年`} value={y} />
              })}
            </Picker>
          </View>

          <View style={styles.yearBtnRow}>
            <TouchableOpacity
              style={[styles.yearActionBtn, styles.yearCancelBtn]}
              onPress={() => {
                setTmpYear(yearConfirmRef.current)
                setYearPickerOpen(false)
              }}
            >
              <Text style={styles.yearCancelText}>取消</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={[styles.yearActionBtn, styles.yearOkBtn]}
              onPress={() => {
                setYear(tmpYear)
                setSelectedMonth(now.getMonth())
                setYearPickerOpen(false)
              }}
            >
              <Text style={styles.yearOkText}>確定</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {loading ? (
        <View style={styles.loadingFloat}>
          <ActivityIndicator />
        </View>
      ) : null}
    </View>
  )
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: '#EFE9E7' },

  allBtn: {
    position: 'absolute',
    left: 6,
    top: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 14,
    backgroundColor: '#E9E3E3',
  },
  allBtnText: {
    fontWeight: '900',
    color: '#8F8F8F',
    fontSize: 13,
  },


  header: {
    height: 150,
    backgroundColor: '#D6B15B',
    paddingTop: 18,
    borderBottomLeftRadius: 22,
    borderBottomRightRadius: 22,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  headerIcon: {
    position: 'absolute',
    left: 14,
    top: 18,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    textAlign: 'center',
    color: '#FFF',
    fontSize: 18,
    fontWeight: '800',
    letterSpacing: 1,
  },
  headerFox: {
    position: 'absolute',
    right: 12,
    top: 24,
    width: 86,
    height: 86,
    opacity: 0.25,
  },
  foxCircle: {
    position: 'absolute',
    right: 0,
    top: 8,
    width: 78,
    height: 78,
    borderRadius: 39,
    backgroundColor: '#B98F33',
  },
  foxSilhouette: {
    position: 'absolute',
    right: 18,
    top: 20,
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#B98F33',
    transform: [{ rotate: '8deg' }],
  },

  yearRow: { position: 'absolute', left: 18, top: 86 },
  yearBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 14,
    backgroundColor: 'rgba(255,255,255,0.15)',
  },
  yearText: { color: '#FFF', fontSize: 18, fontWeight: '900', marginRight: 2 },

  sectionBar: {
    marginTop: 14,
    marginHorizontal: 16,
    backgroundColor: '#F4F1F0',
    borderRadius: 14,
    paddingVertical: 10,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionTitle: { fontSize: 16, fontWeight: '800', color: '#4A4A4A' },

  monthInfoCard: {
    marginHorizontal: 16,
    marginTop: 10,
    backgroundColor: '#F6F3F2',
    borderRadius: 18,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  monthInfoLeft: { flexDirection: 'row', alignItems: 'flex-start', flex: 1 },
  catDot: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  monthInfoTopRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  monthInfoCat: { fontSize: 16, fontWeight: '900', color: '#6A6A6A', marginRight: 6 },
  monthInfoAmt: { fontSize: 14, fontWeight: '800', color: '#9A9A9A' },
  deltaWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#EFE7E7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 14,
    marginLeft: 6,
  },
  deltaText: { fontWeight: '900', marginLeft: 4, fontSize: 12 },
  monthInfoHint: { marginTop: 8, color: '#A0A0A0', fontWeight: '700' },
  
  filterRow: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#F6F3F2',
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: '#C7C7C7',
    marginRight: 10,
  },
  filterText: { fontSize: 15, fontWeight: '800', color: '#6B6B6B' },

  chartBlock: { marginTop: 10 },
  chartTitleRow: {
    marginHorizontal: 16,
    marginTop: 6,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  smallDot: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chartTitleText: { fontSize: 16, fontWeight: '900', color: '#6A6A6A' },
  chartSubText: { fontSize: 12, fontWeight: '800', color: '#A0A0A0' },
  removePill: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: '#EFE7E7',
    alignItems: 'center',
    justifyContent: 'center',
  },

  chartCard: {
    marginHorizontal: 16,
    marginTop: 8,
    backgroundColor: '#F6F3F2',
    borderRadius: 16,
    overflow: 'hidden',
  },
  emptyChart: { height: 220, justifyContent: 'center', alignItems: 'center', padding: 16 },
  emptyBig: { fontSize: 20, fontWeight: '900', color: '#B0B0B0' },
  emptySub: { marginTop: 6, color: '#C0C0C0', fontWeight: '700' },
  monthTicks: {
    marginTop: 18,
    width: '100%',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  monthTick: { fontSize: 11, color: '#BDBDBD' },

  pinCard: {
    marginHorizontal: 16,
    marginTop: 12,
    backgroundColor: '#F6F3F2',
    borderRadius: 16,
    padding: 18,
    borderWidth: 2,
    borderColor: '#E6DEDD',
    borderStyle: 'dashed',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  pinPlus: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#EDE6E5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  pinText: { color: '#B0B0B0', fontWeight: '800' },

  pdfCard: { marginHorizontal: 16, marginTop: 12 },
  pdfBtn: {
    backgroundColor: '#D32F2F',
    padding: 12,
    borderRadius: 14,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pdfBtnText: { color: '#FFF', fontWeight: '900', marginLeft: 8 },

  modalMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  modalSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#F2EFEF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingBottom: 16,
    paddingTop: 10,
    paddingHorizontal: 14,
  },
  modalTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 10,
  },
  tabRow: { flexDirection: 'row', backgroundColor: '#E9E3E3', borderRadius: 16, overflow: 'hidden' },
  tabBtn: { paddingHorizontal: 18, paddingVertical: 10 },
  tabBtnActive: { backgroundColor: '#F7F3F3' },
  tabText: { fontWeight: '900', color: '#9E9E9E' },
  tabTextActive: { color: '#D6B15B' },
  checkBtn: { position: 'absolute', right: 6, top: 8, padding: 10 },

  modalHint: { textAlign: 'center', color: '#B0B0B0', fontWeight: '800', marginTop: 10, marginBottom: 12 },

  modeRow: {
    flexDirection: 'row',
    alignSelf: 'center',
    backgroundColor: '#E9E3E3',
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
  },
  modeBtn: { paddingHorizontal: 22, paddingVertical: 10 },
  modeBtnOn: { backgroundColor: '#F7F3F3' },
  modeText: { fontWeight: '900', color: '#9E9E9E' },
  modeTextOn: { color: '#D6B15B' },

  catGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between', paddingHorizontal: 8 },
  catCell: { width: '25%', alignItems: 'center', paddingVertical: 12, gap: 6 },
  catText: { fontSize: 12, color: '#B0B0B0', fontWeight: '800' },


  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F7F3F3',
    borderRadius: 14,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 10,
  },
  searchInput: { flex: 1, paddingHorizontal: 8, color: '#666', fontWeight: '700' },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#E5DEDD',
  },
  itemCheck: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D0CACA',
    marginRight: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  itemCheckOn: { backgroundColor: '#D6B15B', borderColor: '#D6B15B' },
  itemText: { flex: 1, color: '#666', fontWeight: '800' },

  loadingFloat: { position: 'absolute', left: 0, right: 0, top: 150, alignItems: 'center' },

  yearMask: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)' },
  yearSheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: '#F2EFEF',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingTop: 12,
    paddingBottom: 16,
    paddingHorizontal: 16,
  },
  yearTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  yearTitle: { fontSize: 16, fontWeight: '900', color: '#8C8C8C' },
  yearClose: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },

  pickerWrap: {
    backgroundColor: '#F7F3F3',
    borderRadius: 18,
    overflow: 'hidden',
    paddingVertical: 8,
    marginTop: 6,
  },
  pickerItem: { fontSize: 22, fontWeight: '800', color: '#333' },

  yearBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 12,
  },
  yearActionBtn: {
    flex: 1,
    height: 52,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  yearCancelBtn: { backgroundColor: '#E9E3E3' },
  yearOkBtn: { backgroundColor: '#D6B15B' },
  yearCancelText: { fontSize: 16, fontWeight: '900', color: '#8F8F8F' },
  yearOkText: { fontSize: 16, fontWeight: '900', color: '#FFF' },
})
